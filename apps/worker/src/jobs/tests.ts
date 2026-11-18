import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { LineResult, type DrillEventSink, type Test, type TestResult } from "@dappdrill/core";
import { accountOf, appTests, testRuns, type Db, type TestRunRow } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import type { PgBoss } from "pg-boss";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger, type Logger } from "../log.js";
import { notifyBatch } from "../notify/index.js";
import { QUEUES, type TestsJob } from "../queues.js";
import { appSuite, buildTarget, loadApp, type AppRow } from "../target.js";
import { repairAfter } from "./repair.js";
import { stopSignal, throttle } from "./stop.js";
import { appTurn } from "./turn.js";

const FRAME_EVERY_MS = 1000;

/**
 * tests.run: run a batch of tests one after another, in the order they show on the page. No model is
 * used: a test that stopped on a line that isn't code, or whose recording no longer fits the page, is
 * handed to a repair afterwards.
 */
export async function runTestBatch(db: Db, engine: Engine, boss: PgBoss, batchId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`batch ${batchId}`);
  const runs = await db.select().from(testRuns).where(and(eq(testRuns.batchId, batchId), eq(testRuns.status, "queued")));
  if (runs.length === 0) return log.warn("nothing queued; skipping");
  const app = await loadApp(db, runs[0]!.appId);

  // A kept account is one account: jobs on it go one at a time, and the rest wait their turn (the runs stay queued).
  const kept = accountOf(app) === "kept";
  const lock = kept ? await appTurn(db, boss, app.id, QUEUES.tests, { batchId } satisfies TestsJob, log) : undefined;
  if (kept && !lock) return;
  let results: TestResult[] = [];
  try {
    results = await runBatch(db, engine, app, runs, batchId, signal, log);
  } finally {
    await lock?.release();
  }
  // Once, and never after the run a repair asked for itself: what it couldn't repair stays for a person to look at.
  if (runs[0]!.trigger !== "repair") await repairAfter(db, boss, app.id, batchId, results).catch((e) => log.warn(`could not start a repair: ${errorMessage(e)}`));
}

/** Runs the batch and returns the results of the tests that finished. */
async function runBatch(db: Db, engine: Engine, app: AppRow, runs: TestRunRow[], batchId: string, shutdown: AbortSignal, log: Logger): Promise<TestResult[]> {
  const runOf = new Map(runs.map((r) => [r.testId, r]));
  /** The batch's tests, read inside the try below: one that can't be read ends the batch with why rather than leaving it queued. */
  let byId = new Map<string, Test>();
  const dir = artifactsDir("runs", batchId);
  // One write at a time, in the order they were asked for: a line's progress never lands after the test's result.
  let writes: Promise<unknown> = Promise.resolve();
  const setRun = (testId: string, patch: Partial<TestRunRow>): Promise<unknown> =>
    (writes = writes.catch(() => {}).then(() => db.update(testRuns).set(patch).where(eq(testRuns.id, runOf.get(testId)!.id))));
  /** Progress on the way: the page shows it, and a run goes on without it. */
  const progress = (testId: string, patch: Partial<TestRunRow>) => void setRun(testId, patch).catch((e) => log.warn(`could not save a run's progress: ${errorMessage(e)}`));

  // Stopping any of the batch's tests stops the batch: they share one setup.
  const stop = stopSignal(async () => (await db.select({ id: testRuns.id }).from(testRuns).where(and(eq(testRuns.batchId, batchId), eq(testRuns.stopRequested, true))).limit(1)).length > 0, log);
  const signal = AbortSignal.any([shutdown, stop.signal]);

  /** The test running now, and its lines so far. */
  let current: { testId: string; steps: LineResult[] } | undefined;
  const frame = throttle(FRAME_EVERY_MS, async ({ testId, file }: { testId: string; file: string }) => setRun(testId, { liveFrame: file }));
  const sink: DrillEventSink = (event) => {
    if (event.type === "log" && event.level !== "info") log[event.level](event.message);
    else if (event.type === "frame" && current) frame.push({ testId: current.testId, file: path.relative(dir, event.path) });
  };

  const done = new Map<string, TestResult>();
  // A batch may run against another deploy of the app (a preview, staging) instead of its own URL.
  const url = runs[0]!.url ?? undefined;
  let broke: string | undefined;
  try {
    // Page order.
    const suite = appSuite(app, (await appTests(db, app.id)).filter((t) => runOf.has(t.id)));
    byId = new Map(suite.tests.map((t) => [t.id, t]));
    log.info(`started: ${suite.tests.length} tests on ${url ?? app.url}`);
    await engine.runSuite({ target: { ...(await buildTarget(db, app, "tests")), ...(url ? { url } : {}) }, suite, artifactsDir: dir, signal }, sink, {
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
        done.set(result.testId, result);
        current = undefined;
        await frame.flush();
        await setRun(result.testId, { status: result.outcome, result, finishedAt: new Date() });
        log.info(`${byId.get(result.testId)!.name}: ${result.outcome}${result.repairable ? ", needs repairing" : ""}`);
      },
    });
  } catch (e) {
    if (!signal.aborted) {
      broke = errorMessage(e);
      log.error("failed", e);
    }
  } finally {
    stop.end();
  }
  await frame.flush();
  await finishLeftovers(db, [...runOf.values()].filter((r) => !done.has(r.testId)), broke);

  await notifyBatch(db, app, [...runOf.values()].map((r) => r.id), url).catch((e) => log.warn(`notifications failed: ${errorMessage(e)}`));
  // A batch against another deploy says nothing about the app's own tests: nothing is repaired for it.
  return url ? [] : [...done.values()];
}

/** A result for a test still running: the lines done so far. The row's status says it is running. */
const soFar = (running: { testId: string; steps: LineResult[] }): TestResult => ({ testId: running.testId, outcome: "unverified", steps: running.steps, values: {}, cleanup: [], reset: [], repairable: false, signingReviews: [], rerun: false, durationMs: 0, costUsd: 0 });

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
