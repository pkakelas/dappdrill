import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { failedAt, keepActions, TestRunResult, type Blame, type TestRunStatus, type TestStep } from "@dappdrill/core";
import { appTests, apps, explorations, settledRuns, specOf, testRuns, tests, tryAppLock, type Db, type TestRow, type TestRunRow } from "@dappdrill/db";
import type { TestOutcome } from "@dappdrill/engine";
import type { Engine } from "@dappdrill/engine/fake";
import type { PgBoss } from "pg-boss";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger } from "../log.js";
import { notifyBatch } from "../notify/index.js";
import { LIVE_RETRY_SECONDS, QUEUES, type TestsJob } from "../queues.js";
import { buildTarget, liveChains, loadApp, type AppRow } from "../target.js";
import { logEvents } from "./sink.js";
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

async function runBatch(db: Db, engine: Engine, app: AppRow, runs: TestRunRow[], batchId: string, signal: AbortSignal, log: ReturnType<typeof logger>): Promise<void> {

  // Page order: each test followed by its condition rows.
  const ordered = await appTests(db, app.id);
  const rank = new Map(ordered.map((t, i) => [t.id, i]));
  const byTest = new Map(ordered.map((t) => [t.id, t]));
  const runOf = new Map<string, TestRunRow>();
  for (const r of runs.sort((a, b) => (rank.get(a.testId) ?? 0) - (rank.get(b.testId) ?? 0))) runOf.set(r.testId, r);

  const controllers = new Map<string, AbortController>();
  const last = await settledRuns(db, [...runOf.keys()]);
  const items = [...runOf.values()].flatMap((r) => {
    const test = byTest.get(r.testId);
    if (!test) return [];
    const base = test.baseId ? byTest.get(test.baseId) : undefined;
    const c = new AbortController();
    controllers.set(test.id, c);
    return [{ spec: specOf(test), base: base && specOf(base), signal: c.signal, known: knownLook(last.get(test.id), test) }];
  });

  const setRun = (testId: string, patch: Partial<TestRunRow>) => db.update(testRuns).set(patch).where(eq(testRuns.id, runOf.get(testId)!.id));
  const frames = new Map<string, ReturnType<typeof throttle<string>>>();
  const frameOf = (testId: string) => {
    let t = frames.get(testId);
    if (!t) frames.set(testId, (t = throttle(FRAME_EVERY_MS, (path: string) => setRun(testId, { liveFrame: path }))));
    return t;
  };

  const stopPolling = pollStops(
    async () => {
      const rows = await db.select({ testId: testRuns.testId }).from(testRuns).where(and(eq(testRuns.batchId, batchId), eq(testRuns.stopRequested, true)));
      return rows.map((r) => r.testId);
    },
    (testId) => controllers.get(testId)?.abort(),
    log,
  );

  const done = new Set<string>();
  // A batch may run against another deploy of the app (a preview, staging) instead of its own URL.
  const url = runs[0]!.url ?? undefined;
  log.info(`started: ${items.length} tests on ${url ?? app.url}`);
  try {
    await engine.runTests(
      { ...(await buildTarget(db, app, "tests")), ...(url ? { url } : {}) },
      items,
      { artifactsDir: artifactsDir("runs", batchId), map: app.map ?? undefined, setup: app.setup ?? undefined, signal, secondLook: true },
      {
        onStart: async (testId) => void (await setRun(testId, { status: "running", startedAt: new Date() })),
        onProgress: async (testId, result) => void (await setRun(testId, { result })),
        onFrame: async (testId, path) => frameOf(testId).push(path),
        onDone: async (outcome) => {
          done.add(outcome.testId);
          await frames.get(outcome.testId)?.flush();
          await setRun(outcome.testId, { status: outcome.status, result: outcome.result, finishedAt: new Date() });
          if (outcome.steps) await saveSteps(db, outcome.testId, outcome.steps);
          if (outcome.after) await saveAfter(db, outcome.testId, outcome.after);
          await settleDraft(db, outcome);
          await settleBug(db, byTest.get(outcome.testId), outcome);
          const baseId = byTest.get(outcome.testId)?.baseId;
          if (outcome.baseSteps && baseId) await saveSteps(db, baseId, outcome.baseSteps);
          log.info(`${byTest.get(outcome.testId)?.name}: ${outcome.status}`);
        },
        onSecondLook: async (testId, result) => {
          await frames.get(testId)?.flush();
          await setRun(testId, { result });
          log.info(`${byTest.get(testId)?.name}: checked again, ${result.secondLook?.verdict}`);
        },
        onSetupSteps: (steps, reset) => saveSetupSteps(db, app.id, steps, reset),
      },
      logEvents(log),
    );
  } catch (e) {
    if (!signal.aborted) log.error("failed", e);
    await finishLeftovers(db, runOf, done, "error", signal.aborted ? "The worker shut down during the run." : errorMessage(e), "ours");
    return;
  } finally {
    stopPolling();
  }
  await finishLeftovers(db, runOf, done, "stopped");

  await notifyBatch(db, app, [...runOf.values()].map((r) => r.id), url).catch((e) => log.warn(`notifications failed: ${errorMessage(e)}`));
}

/**
 * A verdict on the test's last failure, so the same failure isn't checked again on every run.
 * It is asked again when the test was edited since, or when it blamed the test before looks said
 * whether the app offers the goal at all.
 */
function knownLook(run: TestRunRow | undefined, test: TestRow) {
  const look = run?.status === "fail" ? run.result?.secondLook : undefined;
  if (!run?.result || !look || run.createdAt < test.updatedAt) return undefined;
  const settled = look.verdict === "app" || (look.verdict === "test" && look.notOffered !== undefined);
  return settled ? { at: failedAt(run.result), look } : undefined;
}

/**
 * Saves the actions that worked. The developer may have edited the steps while the
 * test ran, so actions are kept only for steps whose text is still the same.
 */
async function saveSteps(db: Db, testId: string, steps: TestStep[]): Promise<void> {
  const [current] = await db.select({ steps: tests.steps }).from(tests).where(eq(tests.id, testId));
  if (!current) return;
  // The run brings the actions; the checks stay as the row has them, since one may have been kept or removed while it ran.
  const learned = keepActions(current.steps.map((s) => s.text), steps).map(({ checks: _ran, ...s }, i) => {
    const checks = current.steps[i]?.checks;
    return checks?.length ? { ...s, checks } : s;
  });
  await db.update(tests).set({ steps: learned }).where(eq(tests.id, testId));
}

/** Same as saveSteps, for the test's cleanup steps. */
async function saveAfter(db: Db, testId: string, after: TestStep[]): Promise<void> {
  const [current] = await db.select({ after: tests.after }).from(tests).where(eq(tests.id, testId));
  if (!current?.after?.length) return;
  await db
    .update(tests)
    .set({ after: keepActions(current.after.map((s) => s.text), after) })
    .where(eq(tests.id, testId));
}

/** A draft stops being one on its first pass; until then the note says why it isn't there yet. */
async function settleDraft(db: Db, outcome: TestOutcome): Promise<void> {
  // A run we broke says nothing about the draft.
  if (outcome.status === "stopped" || outcome.result.blame === "ours") return;
  const draftNote = outcome.status === "pass" ? null : (outcome.result.failure ?? "It didn't pass.");
  await db.update(tests).set({ draftNote }).where(and(eq(tests.id, outcome.testId), isNotNull(tests.draftNote)));
}

/** A test written from a bug passed, so the bug is fixed. One somebody dismissed stays dismissed. */
async function settleBug(db: Db, test: TestRow | undefined, outcome: TestOutcome): Promise<void> {
  if (!test?.bugId || outcome.status !== "pass") return;
  const has = JSON.stringify([{ id: test.bugId }]);
  const entry = JSON.stringify({ [test.bugId]: "fixed" });
  await db
    .update(explorations)
    .set({ triage: sql`${explorations.triage} || ${entry}::jsonb` })
    .where(and(eq(explorations.appId, test.appId), sql`${explorations.state}->'bugs' @> ${has}::jsonb`, sql`${explorations.triage}->>${test.bugId}::text is distinct from 'dismissed'`));
}

/** Same as saveSteps, for the app's setup. */
async function saveSetupSteps(db: Db, appId: string, steps: TestStep[], reset?: TestStep[]): Promise<void> {
  const [current] = await db.select({ setup: apps.setup }).from(apps).where(eq(apps.id, appId));
  if (!current?.setup) return;
  const kept = reset && current.setup.reset ? keepActions(current.setup.reset.map((s) => s.text), reset) : current.setup.reset;
  await db
    .update(apps)
    .set({ setup: { ...current.setup, steps: keepActions(current.setup.steps.map((s) => s.text), steps), ...(kept ? { reset: kept } : {}) } })
    .where(eq(apps.id, appId));
}

/** Runs the engine never finished (a stop of the whole batch, a crash). */
async function finishLeftovers(db: Db, runOf: Map<string, TestRunRow>, done: Set<string>, status: TestRunStatus, failure?: string, blame?: Blame): Promise<void> {
  const ids = [...runOf.values()].filter((r) => !done.has(r.testId)).map((r) => r.id);
  if (ids.length === 0) return;
  for (const row of await db.select({ id: testRuns.id, result: testRuns.result }).from(testRuns).where(inArray(testRuns.id, ids))) {
    // Keep the progress already written; steps that never finished show as skipped.
    const result = TestRunResult.parse(row.result ?? {});
    for (const s of result.steps) if (s.status === "pending" || s.status === "running") s.status = "skipped";
    if (failure) result.failure = failure;
    if (blame) result.blame = blame;
    await db.update(testRuns).set({ status, result, finishedAt: new Date() }).where(eq(testRuns.id, row.id));
  }
}
