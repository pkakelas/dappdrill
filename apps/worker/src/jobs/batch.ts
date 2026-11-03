import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { DEFAULT_EDGE_CASES, newId, type DrillTarget, type Flow, type FlowRun, type Variation } from "@dappdrill/core";
import { flows, repairs, runBatches, variations, type Db, type JobStatus } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger, type Logger } from "../log.js";
import { notifyAfter } from "../notify/index.js";
import { closeFixed, Persister } from "../persist.js";
import { buildTarget, loadApp, loadBaselines, replayChains } from "../target.js";
import { logEvents, serialSink } from "./sink.js";

/** batch.run: replay saved flows, store the results, and propose repairs for flows that broke. */
export async function runBatch(db: Db, engine: Engine, batchId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`batch ${batchId}`);
  const [batch] = await db.select().from(runBatches).where(eq(runBatches.id, batchId));
  if (!batch) return log.warn("no such batch; skipping");
  if (batch.status !== "queued") return log.warn(`batch is ${batch.status}, not queued; skipping`);
  const update = (patch: Partial<typeof runBatches.$inferInsert>) => db.update(runBatches).set(patch).where(eq(runBatches.id, batchId));
  await update({ status: "running", startedAt: new Date() });

  const app = await loadApp(db, batch.appId);
  const rows = batch.request.flowIds.length
    ? await db.select().from(flows).where(and(eq(flows.appId, app.id), inArray(flows.id, batch.request.flowIds)))
    : [];
  // The row id is the flow's identity, whatever the stored definition says.
  const flowList: Flow[] = rows.map((r) => ({ ...r.definition, id: r.id, name: r.name }));
  const persister = new Persister(db, { appId: app.id, batchId }, flowList.map((f) => f.id));
  const dir = artifactsDir("batches", batchId);

  let status: JobStatus = "done";
  let error: string | null = null;
  try {
    if (flowList.length === 0) throw new Error("None of the requested flows exist any more.");
    const target = await buildTarget(db, app, app.settings, await replayChains(db, app));
    const { sink, drain } = serialSink(async (event) => {
      if (event.type === "run") await persister.run(event.run);
      else if (event.type === "issue") await persister.issue(event.issue);
      else if (event.type === "signing-review") await persister.review(event.review);
      else if (event.type === "log" && event.level !== "info") log[event.level](event.message);
    }, log);
    log.info(`replaying ${flowList.length} flow(s) on ${app.url}`);
    const result = await engine.replay(
      target,
      flowList,
      {
        edgeCases: batch.request.edgeCases.length ? batch.request.edgeCases : DEFAULT_EDGE_CASES,
        variation: batch.request.variationId ? await loadVariation(db, batch.request.variationId) : undefined,
        artifactsDir: dir,
        baselines: await loadBaselines(db, app.id),
      },
      sink,
      signal,
    );
    await drain();
    await persister.all(result);
    if (signal.aborted) [status, error] = ["failed", "The worker shut down during the run."];
    else {
      await closeFixed(db, app.id, persister, log, false);
      await proposeRepairs(db, engine, target, flowList, [...persister.written.runs.values()], join(dir, "repairs"), log);
    }
  } catch (e) {
    [status, error] = ["failed", signal.aborted ? "The worker shut down during the run." : errorMessage(e)];
    log.error("failed", e);
  }

  await update({ status, error, finishedAt: new Date() });
  log.info(`${status}: ${persister.summary()}`);
  if (status === "done") {
    await notifyAfter(db, {
      app,
      what: batch.trigger === "schedule" ? "scheduled run" : "run",
      path: `/apps/${app.id}/runs/${batchId}`,
      persister,
      report: persister.asReport(app.url, flowList),
    }).catch((e) => log.warn(`notifications failed: ${errorMessage(e)}`));
  }
}

async function loadVariation(db: Db, id: string): Promise<Variation | undefined> {
  const [v] = await db.select().from(variations).where(eq(variations.id, id));
  if (!v) return undefined;
  return { id: v.id, name: v.name, inputs: v.inputs, wallet: v.wallet ?? undefined, chainId: v.chainId ?? undefined, account: v.account ?? undefined };
}

/** One repair per flow that broke at a step, unless one is already waiting for a person. */
async function proposeRepairs(db: Db, engine: Engine, target: DrillTarget, flowList: Flow[], runList: FlowRun[], dir: string, log: Logger): Promise<void> {
  const broken = new Map<string, FlowRun>();
  for (const run of runList) {
    if (run.status !== "fail" || !run.steps.some((s) => s.status === "fail")) continue;
    // Prefer the happy-path run: it's the cleanest evidence of what changed.
    if (!broken.has(run.flowId) || run.edgeCase === "happy") broken.set(run.flowId, run);
  }
  for (const [flowId, run] of broken) {
    const flow = flowList.find((f) => f.id === flowId);
    if (!flow) continue;
    const [open] = await db.select({ id: repairs.id }).from(repairs).where(and(eq(repairs.flowId, flowId), eq(repairs.status, "open"))).limit(1);
    if (open) continue;
    try {
      const fix = await engine.repairFlow(target, flow, run, { artifactsDir: join(dir, flowId) }, logEvents(log));
      if (!fix) {
        log.info(`no repair found for ${flow.name}`);
        continue;
      }
      await db.insert(repairs).values({ id: newId("rep"), flowId, runId: run.id, explanation: fix.explanation, proposed: { ...fix.flow, id: flowId }, status: "open" });
      log.info(`proposed a repair for ${flow.name}`);
    } catch (e) {
      log.warn(`repair of ${flow.name} failed: ${errorMessage(e)}`);
    }
  }
}
