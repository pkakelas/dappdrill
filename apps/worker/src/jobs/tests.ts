import { and, eq, inArray } from "drizzle-orm";
import { keepActions, TestRunResult, type TestRunStatus, type TestStep } from "@dappdrill/core";
import { appTests, apps, specOf, testRuns, tests, type Db, type TestRunRow } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger } from "../log.js";
import { notifyBatch } from "../notify/index.js";
import { buildTarget, loadApp } from "../target.js";
import { logEvents } from "./sink.js";
import { pollStops, throttle } from "./stop.js";

const FRAME_EVERY_MS = 1000;

/** tests.run: run a batch of tests one after another, in the order they show on the page. */
export async function runTestBatch(db: Db, engine: Engine, batchId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`batch ${batchId}`);
  const runs = await db.select().from(testRuns).where(and(eq(testRuns.batchId, batchId), eq(testRuns.status, "queued")));
  if (runs.length === 0) return log.warn("nothing queued; skipping");
  const app = await loadApp(db, runs[0]!.appId);

  // Page order: each test followed by its condition rows.
  const ordered = await appTests(db, app.id);
  const rank = new Map(ordered.map((t, i) => [t.id, i]));
  const byTest = new Map(ordered.map((t) => [t.id, t]));
  const runOf = new Map<string, TestRunRow>();
  for (const r of runs.sort((a, b) => (rank.get(a.testId) ?? 0) - (rank.get(b.testId) ?? 0))) runOf.set(r.testId, r);

  const controllers = new Map<string, AbortController>();
  const items = [...runOf.values()].flatMap((r) => {
    const test = byTest.get(r.testId);
    if (!test) return [];
    const base = test.baseId ? byTest.get(test.baseId) : undefined;
    const c = new AbortController();
    controllers.set(test.id, c);
    return [{ spec: specOf(test), base: base && specOf(base), signal: c.signal }];
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
  log.info(`started: ${items.length} tests on ${app.url}`);
  try {
    await engine.runTests(
      await buildTarget(db, app, "tests"),
      items,
      { artifactsDir: artifactsDir("runs", batchId), map: app.map ?? undefined, setup: app.setup ?? undefined, signal },
      {
        onStart: async (testId) => void (await setRun(testId, { status: "running", startedAt: new Date() })),
        onProgress: async (testId, result) => void (await setRun(testId, { result })),
        onFrame: async (testId, path) => frameOf(testId).push(path),
        onDone: async (outcome) => {
          done.add(outcome.testId);
          await frames.get(outcome.testId)?.flush();
          await setRun(outcome.testId, { status: outcome.status, result: outcome.result, finishedAt: new Date() });
          if (outcome.steps) await saveSteps(db, outcome.testId, outcome.steps);
          const baseId = byTest.get(outcome.testId)?.baseId;
          if (outcome.baseSteps && baseId) await saveSteps(db, baseId, outcome.baseSteps);
          log.info(`${byTest.get(outcome.testId)?.name}: ${outcome.status}`);
        },
        onSetupSteps: (steps) => saveSetupSteps(db, app.id, steps),
      },
      logEvents(log),
    );
  } catch (e) {
    if (!signal.aborted) log.error("failed", e);
    await finishLeftovers(db, runOf, done, "error", signal.aborted ? "The worker shut down during the run." : errorMessage(e));
    return;
  } finally {
    stopPolling();
  }
  await finishLeftovers(db, runOf, done, "stopped");

  await notifyBatch(db, app, [...runOf.values()].map((r) => r.id)).catch((e) => log.warn(`notifications failed: ${errorMessage(e)}`));
}

/**
 * Saves the actions that worked. The developer may have edited the steps while the
 * test ran, so actions are kept only for steps whose text is still the same.
 */
async function saveSteps(db: Db, testId: string, steps: TestStep[]): Promise<void> {
  const [current] = await db.select({ steps: tests.steps }).from(tests).where(eq(tests.id, testId));
  if (!current) return;
  await db
    .update(tests)
    .set({ steps: keepActions(current.steps.map((s) => s.text), steps) })
    .where(eq(tests.id, testId));
}

/** Same as saveSteps, for the app's setup. */
async function saveSetupSteps(db: Db, appId: string, steps: TestStep[]): Promise<void> {
  const [current] = await db.select({ setup: apps.setup }).from(apps).where(eq(apps.id, appId));
  if (!current?.setup) return;
  await db
    .update(apps)
    .set({ setup: { ...current.setup, steps: keepActions(current.setup.steps.map((s) => s.text), steps) } })
    .where(eq(apps.id, appId));
}

/** Runs the engine never finished (a stop of the whole batch, a crash). */
async function finishLeftovers(db: Db, runOf: Map<string, TestRunRow>, done: Set<string>, status: TestRunStatus, failure?: string): Promise<void> {
  const ids = [...runOf.values()].filter((r) => !done.has(r.testId)).map((r) => r.id);
  if (ids.length === 0) return;
  for (const row of await db.select({ id: testRuns.id, result: testRuns.result }).from(testRuns).where(inArray(testRuns.id, ids))) {
    // Keep the progress already written; steps that never finished show as skipped.
    const result = TestRunResult.parse(row.result ?? {});
    for (const s of result.steps) if (s.status === "pending" || s.status === "running") s.status = "skipped";
    if (failure) result.failure = failure;
    await db.update(testRuns).set({ status, result, finishedAt: new Date() }).where(eq(testRuns.id, row.id));
  }
}
