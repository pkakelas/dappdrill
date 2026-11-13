import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { LineResult, sentence, setupWithRecordings, withRecordings, type ChainConfig, type DrillEventSink, type Test, type TestResult } from "@dappdrill/core";
import { appTests, apps, suiteOf, testOf, testRuns, tests, tryAppLock, type Db, type TestRunRow } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import type { PgBoss } from "pg-boss";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger, type Logger } from "../log.js";
import { notifyBatch } from "../notify/index.js";
import { LIVE_RETRY_SECONDS, QUEUES, type TestsJob } from "../queues.js";
import { buildTarget, liveChains, loadApp, ownerNotes, type AppRow } from "../target.js";
import { pollStops, throttle } from "./stop.js";

const FRAME_EVERY_MS = 1000;

/** tests.run: run a batch of tests one after another, in the order they show on the page. */
export async function runTestBatch(db: Db, engine: Engine, boss: PgBoss, batchId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`batch ${batchId}`);
  const runs = await db.select().from(testRuns).where(and(eq(testRuns.batchId, batchId), eq(testRuns.status, "queued")));
  if (runs.length === 0) return log.warn("nothing queued; skipping");
  const app = await loadApp(db, runs[0]!.appId);

  // A live account is one account: jobs on it go one at a time, and the rest wait their turn (the runs stay queued).
  const lock = liveChains(app) ? await tryAppLock(db, app.id) : undefined;
  if (liveChains(app) && !lock) {
    log.info(`another job is on this app's live chain; looking again in ${LIVE_RETRY_SECONDS}s`);
    await boss.send(QUEUES.tests, { batchId } satisfies TestsJob, { startAfter: LIVE_RETRY_SECONDS });
    return;
  }
  try {
    await runBatch(db, engine, app, runs, batchId, signal, log);
  } finally {
    await lock?.release();
  }
}

async function runBatch(db: Db, engine: Engine, app: AppRow, runs: TestRunRow[], batchId: string, shutdown: AbortSignal, log: Logger): Promise<void> {
  const runOf = new Map(runs.map((r) => [r.testId, r]));
  // Page order.
  const suite = { ...suiteOf(app, (await appTests(db, app.id)).filter((t) => runOf.has(t.id))), ...ownerNotes(app) };
  const byId = new Map(suite.tests.map((t) => [t.id, t]));
  const dir = artifactsDir("runs", batchId);
  // One write at a time, in the order they were asked for: a line's progress never lands after the test's result.
  let writes: Promise<unknown> = Promise.resolve();
  const setRun = (testId: string, patch: Partial<TestRunRow>): Promise<unknown> =>
    (writes = writes.catch(() => {}).then(() => db.update(testRuns).set(patch).where(eq(testRuns.id, runOf.get(testId)!.id))));
  /** Progress on the way: the page shows it, and a run goes on without it. */
  const progress = (testId: string, patch: Partial<TestRunRow>) => void setRun(testId, patch).catch((e) => log.warn(`could not save a run's progress: ${errorMessage(e)}`));

  // Stopping any of the batch's tests stops the batch: they share one browser setup and one set of chains.
  const stop = new AbortController();
  const stopPolling = pollStops(
    async () => ((await db.select({ id: testRuns.id }).from(testRuns).where(and(eq(testRuns.batchId, batchId), eq(testRuns.stopRequested, true))).limit(1)).length ? [batchId] : []),
    () => stop.abort(),
    log,
  );
  const signal = AbortSignal.any([shutdown, stop.signal]);

  /** The test running now, and its lines so far. */
  let current: { testId: string; steps: LineResult[] } | undefined;
  const frame = throttle(FRAME_EVERY_MS, async ({ testId, file }: { testId: string; file: string }) => setRun(testId, { liveFrame: file }));
  let chains: ChainConfig[] = [];
  const sink: DrillEventSink = (event) => {
    if (event.type === "log" && event.level !== "info") log[event.level](event.message);
    else if (event.type === "chains") chains = event.chains;
    else if (event.type === "frame" && current) frame.push({ testId: current.testId, file: path.relative(dir, event.path) });
  };

  const done = new Set<string>();
  // A batch may run against another deploy of the app (a preview, staging) instead of its own URL.
  const url = runs[0]!.url ?? undefined;
  log.info(`started: ${suite.tests.length} tests on ${url ?? app.url}`);
  let broke: string | undefined;
  try {
    const result = await engine.runSuite({ target: { ...(await buildTarget(db, app, "tests")), ...(url ? { url } : {}) }, suite, artifactsDir: dir, signal }, sink, {
      onStart: (testId) => {
        // A test that failed starts a second time: its lines begin again.
        const first = current?.testId !== testId;
        current = { testId, steps: byId.get(testId)!.steps.map((line) => LineResult.parse({ status: "skipped", by: line.by })) };
        progress(testId, { status: "running", ...(first ? { startedAt: new Date() } : {}), result: soFar(current) });
      },
      onLine: (testId, index, line) => {
        if (!testId || current?.testId !== testId) return;
        current.steps[index] = line;
        progress(testId, { result: soFar(current) });
      },
      onTest: async (result) => {
        done.add(result.testId);
        current = undefined;
        await frame.flush();
        await setRun(result.testId, { status: result.outcome, result, finishedAt: new Date() });
        await keepRecordings(db, byId.get(result.testId)!, result);
        log.info(`${byId.get(result.testId)!.name}: ${result.outcome}`);
      },
    });
    await keepSetup(db, app.id, result.setup);
  } catch (e) {
    if (!signal.aborted) {
      broke = errorMessage(e);
      log.error("failed", e);
    }
  } finally {
    stopPolling();
  }
  await frame.flush();
  await finishLeftovers(db, [...runOf.values()].filter((r) => !done.has(r.testId)), broke);
  await keepRelays(db, app.id, chains).catch((e) => log.warn(`could not save the chains whose copy fell behind: ${errorMessage(e)}`));

  await notifyBatch(db, app, [...runOf.values()].map((r) => r.id), url).catch((e) => log.warn(`notifications failed: ${errorMessage(e)}`));
}

/** A result for a test still running: the lines done so far. The row's status says it is running. */
const soFar = (running: { testId: string; steps: LineResult[] }): TestResult => ({ testId: running.testId, outcome: "unverified", steps: running.steps, values: {}, cleanup: [], signingReviews: [], rerun: false, durationMs: 0, costUsd: 0 });

/**
 * Runs the engine never finished. Stopped when somebody stopped the batch or the worker shut down;
 * Couldn't verify, with why, when our side broke. The lines already done are kept.
 */
async function finishLeftovers(db: Db, left: TestRunRow[], broke: string | undefined): Promise<void> {
  if (left.length === 0) return;
  for (const row of await db.select({ id: testRuns.id, testId: testRuns.testId, result: testRuns.result }).from(testRuns).where(inArray(testRuns.id, left.map((r) => r.id)))) {
    const result: TestResult | null = broke ? { ...(row.result ?? soFar({ testId: row.testId, steps: [] })), outcome: "unverified", reason: `It broke on our side: ${broke}` } : row.result;
    await db.update(testRuns).set({ status: broke ? "unverified" : "stopped", result, finishedAt: new Date() }).where(eq(testRuns.id, row.id));
  }
}

/**
 * Saves the browser actions a model took for a code action, so the next run replays them. The
 * test may have been edited while it ran: nothing is saved unless its lines still read the same.
 */
async function keepRecordings(db: Db, ran: Test, result: TestResult): Promise<void> {
  if (!result.steps.some((s) => s.recorded?.length)) return;
  const [row] = await db.select().from(tests).where(eq(tests.id, ran.id));
  if (!row) return;
  const now = testOf(row);
  const reads = (t: Test) => JSON.stringify([t.steps.map(sentence), t.values]);
  if (reads(now) !== reads(ran)) return;
  await db.update(tests).set({ steps: withRecordings(now, result).steps }).where(eq(tests.id, ran.id));
}

/** Same as keepRecordings, for the app's setup. */
async function keepSetup(db: Db, appId: string, lines: LineResult[] | undefined): Promise<void> {
  if (!lines?.some((s) => s.recorded?.length)) return;
  const { suite } = await loadApp(db, appId);
  if (!suite.setup || suite.setup.steps.length !== lines.length) return;
  await db.update(apps).set({ suite: { ...suite, setup: setupWithRecordings(suite.setup, lines) } }).where(eq(apps.id, appId));
}

/**
 * Chains whose copy fell behind the real one during the batch (after the wallet signed there, the app's
 * server acted for it on the real chain): every later run forks them near their latest block.
 */
async function keepRelays(db: Db, appId: string, chains: ChainConfig[]): Promise<void> {
  const relayed = chains.filter((c) => c.relays);
  if (!relayed.length) return;
  const { chains: stored } = await loadApp(db, appId);
  const known = stored.map((c) => (relayed.some((r) => r.id === c.id) ? { ...c, relays: true } : c));
  const added = relayed.filter((r) => !stored.some((c) => c.id === r.id));
  await db.update(apps).set({ chains: [...known, ...added] }).where(eq(apps.id, appId));
}
