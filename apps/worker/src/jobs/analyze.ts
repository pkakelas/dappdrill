import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { newId, type AppSetup, type DrillEvent, type SetupDraft } from "@dappdrill/core";
import { analyses, apps, flows, nextPosition, queueRuns, tests, type Db, type JobStatus } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger } from "../log.js";
import { QUEUES, type TestsJob } from "../queues.js";
import { buildTarget, loadApp, targetHints } from "../target.js";
import { serialSink } from "./sink.js";
import { pollStops } from "./stop.js";

type AnalysisRow = typeof analyses.$inferSelect;
const MAX_LOG = 200;

/**
 * analysis.run: look around the app for a couple of minutes, save what it learned,
 * add a flow with a happy-path test for each thing users do (and the setup they all
 * need, if any), and run those tests.
 */
export async function runAnalysis(db: Db, engine: Engine, boss: PgBoss, analysisId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`analysis ${analysisId}`);
  const [row] = await db.select().from(analyses).where(eq(analyses.id, analysisId));
  if (!row) return log.warn("no such analysis; skipping");
  if (row.status !== "queued") return log.warn(`analysis is ${row.status}, not queued; skipping`);
  const update = (patch: Partial<AnalysisRow>) => db.update(analyses).set(patch).where(eq(analyses.id, analysisId));
  if (row.stopRequested) return void (await update({ status: "stopped", finishedAt: new Date() }));

  const app = await loadApp(db, row.appId);
  const stop = new AbortController();
  const stopPolling = pollStops(
    async () => {
      const [r] = await db.select({ stop: analyses.stopRequested }).from(analyses).where(eq(analyses.id, analysisId));
      return r?.stop ? [analysisId] : [];
    },
    () => stop.abort(),
    log,
  );
  const abort = AbortSignal.any([stop.signal, signal]);

  const lines = [...row.log];
  const { sink, drain } = serialSink(async (event: DrillEvent) => {
    if (event.type === "frame") return void (await update({ liveFrame: event.path }));
    if (event.type === "log" && event.level !== "error") {
      lines.push({ at: event.at, text: event.message });
      await update({ log: lines.slice(-MAX_LOG) });
    }
  }, log);

  await update({ status: "running", startedAt: new Date() });
  log.info(`started: ${app.url}`);

  let status: JobStatus = "done";
  let error: string | null = null;
  let created: string[] = [];
  try {
    const out = await engine.analyze(await buildTarget(db, app, "analysis"), { artifactsDir: artifactsDir("analyses", analysisId), hints: targetHints(app.settings) }, sink, abort);
    await drain();
    await db
      .update(apps)
      .set({
        ...(out.map ? { map: out.map } : {}),
        ...(out.chains.length ? { chains: out.chains } : {}),
        // A setup the developer already has (maybe edited) wins over a new proposal.
        ...(out.setup && !app.setup ? { setup: setupOf(out.setup) } : {}),
      })
      .where(eq(apps.id, app.id));
    created = await addFlows(db, app.id, out.flows);
    await update({ blocked: out.blocked ?? null, stalled: out.stalled ?? null, costUsd: out.costUsd });
  } catch (e) {
    await drain();
    error = errorMessage(e);
    if (!abort.aborted) log.error("failed", e);
  } finally {
    stopPolling();
  }
  // A stop wins over whatever the engine did with the abort (return early or throw).
  if (stop.signal.aborted) [status, error] = ["stopped", null];
  else if (signal.aborted) [status, error] = ["failed", "The worker shut down during the analysis."];
  else if (error) status = "failed";
  await update({ status, error, finishedAt: new Date() });
  log.info(`${status}: ${created.length} new tests`);

  // Show the new tests working right away (not after a stop: the developer wanted it to end).
  if (status === "done" && created.length) {
    const batchId = await queueRuns(db, app.id, created, "analysis");
    if (batchId) await boss.send(QUEUES.tests, { batchId } satisfies TestsJob);
  }
}

function setupOf(draft: SetupDraft): AppSetup {
  return { startPath: draft.startPath || "/", steps: draft.steps.map((text) => ({ text })), when: draft.when, why: draft.why };
}

/**
 * A flow per draft. A name the app already has is reused: it gets the draft's goal if it has none,
 * and the draft's test if it has no tests. Flows without a test stay as Not tested. Returns the new test ids.
 */
async function addFlows(db: Db, appId: string, drafts: Awaited<ReturnType<Engine["analyze"]>>["flows"]): Promise<string[]> {
  const existing = await db.select({ id: flows.id, name: flows.name, goal: flows.goal }).from(flows).where(eq(flows.appId, appId));
  const have = new Map(existing.map((f) => [f.name.toLowerCase(), f]));
  const tested = new Set((await db.select({ flowId: tests.flowId }).from(tests).where(eq(tests.appId, appId))).map((t) => t.flowId));
  let position = await nextPosition(db, appId);
  const ids: string[] = [];
  for (const draft of drafts) {
    const known = have.get(draft.name.toLowerCase());
    if (known && !known.goal && draft.goal) await db.update(flows).set({ goal: draft.goal }).where(eq(flows.id, known.id));
    const flowId = known?.id ?? newId("flow");
    if (!known) {
      have.set(draft.name.toLowerCase(), { id: flowId, name: draft.name, goal: draft.goal });
      await db.insert(flows).values({ id: flowId, appId, name: draft.name, goal: draft.goal, position: position++ });
    }
    // A flow that was Not tested takes the new test; one that has tests keeps them.
    if (!draft.test || tested.has(flowId)) continue;
    tested.add(flowId);
    const testId = newId("test");
    await db.insert(tests).values({
      id: testId,
      appId,
      flowId,
      name: draft.test.name,
      goal: draft.test.goal,
      expected: draft.test.expected,
      startPath: draft.test.startPath,
      steps: draft.test.steps.map((text) => ({ text })),
    });
    ids.push(testId);
  }
  return ids;
}
