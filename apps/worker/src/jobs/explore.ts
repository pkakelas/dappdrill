import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { ExploreState, newId, type DrillEvent, type ExploreCandidate, type TestStep } from "@dappdrill/core";
import { addConditions, apps, explorations, flows, flowsWithTests, nextPosition, queueRuns, tests, type Db, type JobStatus } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import { QUEUES, type TestsJob } from "../queues.js";
import { buildTarget, loadApp, targetHints } from "../target.js";
import { serialSink } from "./sink.js";
import { pollStops, throttle } from "./stop.js";

type ExplorationRow = typeof explorations.$inferSelect;

/** Often enough to feel live; the state is a few hundred KB by the end. */
const STATE_EVERY_MS = 1200;

/**
 * exploration.run: explore the app in depth. Tests are saved as they prove themselves, and
 * drafts with their reason; at the end the proved tests get a first run with their conditions.
 */
export async function runExploration(db: Db, engine: Engine, boss: PgBoss, explorationId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`exploration ${explorationId}`);
  const [row] = await db.select().from(explorations).where(eq(explorations.id, explorationId));
  if (!row) return log.warn("no such exploration; skipping");
  if (row.status !== "queued") return log.warn(`exploration is ${row.status}, not queued; skipping`);
  const update = (patch: Partial<ExplorationRow>) => db.update(explorations).set(patch).where(eq(explorations.id, explorationId));
  if (row.stopRequested) return void (await update({ status: "stopped", finishedAt: new Date() }));

  const app = await loadApp(db, row.appId);
  const stop = new AbortController();
  const stopPolling = pollStops(
    async () => {
      const [r] = await db.select({ stop: explorations.stopRequested }).from(explorations).where(eq(explorations.id, explorationId));
      return r?.stop ? [explorationId] : [];
    },
    () => stop.abort(),
    log,
  );
  const abort = AbortSignal.any([stop.signal, signal]);

  const state = throttle(STATE_EVERY_MS, (value: ExploreState) => update({ state: value }));
  const { sink, drain } = serialSink(async (event: DrillEvent) => {
    if (event.type === "explore") state.push(ExploreState.parse(event.state));
    else if (event.type === "cost") await update({ costUsd: event.usd });
    else if (event.type === "chains") return;
    else if (event.type === "log" && event.level !== "info") log.warn(event.message);
  }, log);

  const known = await flowsWithTests(db, app.id);
  const created: string[] = [];
  const save = (c: ExploreCandidate) => saveTest(db, app.id, c).then((ids) => void created.push(...ids));

  await update({ status: "running", startedAt: new Date() });
  log.info(`started: ${app.url}, ${row.budgetMinutes} minutes`);

  let status: JobStatus = "done";
  let error: string | null = null;
  try {
    const out = await engine.explore(
      await buildTarget(db, app, "tests"),
      {
        artifactsDir: artifactsDir("explorations", explorationId),
        budgetMinutes: row.budgetMinutes,
        hints: targetHints(app.settings),
        map: app.map ?? undefined,
        setup: app.setup ?? undefined,
        slots: config.explorers,
        tests: known.flatMap((f) => f.tests.filter((t) => !t.baseId).map((t) => ({ id: t.id, name: t.name, goal: t.goal, flow: f.name }))),
      },
      {
        onTest: save,
        onSetupSteps: (steps) => saveSetup(db, app.id, steps),
      },
      sink,
      abort,
    );
    await drain();
    await state.flush();
    await update({ state: out.state, replays: out.replays, blocked: out.blocked ?? null, costUsd: out.costUsd });
    if (out.state.stopped) error = out.state.stopped;
  } catch (e) {
    await drain();
    await state.flush();
    error = errorMessage(e);
    if (!abort.aborted) log.error("failed", e);
  } finally {
    stopPolling();
  }
  if (stop.signal.aborted) [status, error] = ["stopped", null];
  else if (signal.aborted) [status, error] = ["failed", "The worker shut down during the exploration."];
  else if (error) status = "failed";
  await update({ status, error, finishedAt: new Date() });
  log.info(`${status}: ${created.length} new tests`);

  // Show them on the page with a real run. Drafts wait for a person.
  if (status === "done" && created.length) {
    const batchId = await queueRuns(db, app.id, created, "explore");
    if (batchId) await boss.send(QUEUES.tests, { batchId } satisfies TestsJob);
  }
}

/** Puts a candidate in its flow, making the flow if it's new. Returns what should run next: a proved test and its conditions. */
async function saveTest(db: Db, appId: string, c: ExploreCandidate): Promise<string[]> {
  const [known] = await db.select({ id: flows.id }).from(flows).where(and(eq(flows.appId, appId), eq(flows.name, c.flow)));
  let flowId = known?.id;
  if (!flowId) {
    flowId = newId("flow");
    await db.insert(flows).values({ id: flowId, appId, name: c.flow, goal: "", position: await nextPosition(db, appId) });
  }
  const testId = newId("test");
  const proved = c.status === "proved";
  await db.insert(tests).values({
    id: testId,
    appId,
    flowId,
    name: c.draft.name,
    goal: c.draft.goal,
    expected: c.draft.expected,
    startPath: c.draft.startPath,
    steps: c.steps ?? c.draft.steps.map((text) => ({ text })),
    proof: c.proof,
    position: await nextPosition(db, appId, flowId),
    draftNote: proved ? null : (c.note ?? "It didn't pass on a fresh fork."),
  });
  return proved ? [testId, ...(await addConditions(db, testId, c.conditions))] : [];
}

async function saveSetup(db: Db, appId: string, steps: TestStep[]): Promise<void> {
  const [current] = await db.select({ setup: apps.setup }).from(apps).where(eq(apps.id, appId));
  if (current?.setup) await db.update(apps).set({ setup: { ...current.setup, steps } }).where(eq(apps.id, appId));
}

/** sweep.run: repeat a finished exploration's checks with no model. */
export async function runSweep(db: Db, engine: Engine, explorationId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`sweep ${explorationId}`);
  const [row] = await db.select().from(explorations).where(eq(explorations.id, explorationId));
  if (!row || row.replays.length === 0) return;
  const app = await loadApp(db, row.appId);
  try {
    const out = await engine.sweep(await buildTarget(db, app, "tests"), row.replays, { artifactsDir: artifactsDir("explorations", explorationId), setup: app.setup ?? undefined }, undefined, signal);
    await db.update(explorations).set({ sweep: out.sweep }).where(eq(explorations.id, explorationId));
    log.info(`${Object.keys(out.sweep.results).length} checks repeated`);
  } catch (e) {
    if (!signal.aborted) log.error("failed", e);
  }
}
