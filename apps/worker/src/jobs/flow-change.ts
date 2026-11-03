import { and, eq } from "drizzle-orm";
import type { Flow } from "@dappdrill/core";
import { flowChanges, flows, type Db } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger } from "../log.js";
import { buildTarget, loadApp } from "../target.js";
import { logEvents } from "./sink.js";

/** flow-change.run: turn a plain-English request into a proposed flow for a person to review. */
export async function runFlowChange(db: Db, engine: Engine, changeId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`change ${changeId}`);
  const [change] = await db.select().from(flowChanges).where(eq(flowChanges.id, changeId));
  if (!change) return log.warn("no such flow change; skipping");
  if (change.status !== "queued") return log.warn(`flow change is ${change.status}, not queued; skipping`);
  const update = (patch: Partial<typeof flowChanges.$inferInsert>) => db.update(flowChanges).set(patch).where(eq(flowChanges.id, changeId));
  await update({ status: "running" });

  try {
    const app = await loadApp(db, change.appId);
    let existing: Flow | undefined;
    if (change.flowId) {
      const [row] = await db.select().from(flows).where(and(eq(flows.id, change.flowId), eq(flows.appId, app.id)));
      if (!row) throw new Error("The flow to change no longer exists.");
      existing = { ...row.definition, id: row.id, name: row.name };
    }
    log.info(existing ? `changing "${existing.name}": ${change.prompt}` : `new flow: ${change.prompt}`);
    const work = engine.describeFlow(
      await buildTarget(db, app, app.settings),
      change.prompt,
      { artifactsDir: artifactsDir("flow-changes", changeId), existing },
      logEvents(log),
    );
    // describeFlow takes no signal; on shutdown we stop waiting and mark the change failed.
    const result = await Promise.race([work, aborted(signal)]);
    const proposed = existing ? { ...result.flow, id: existing.id } : result.flow;
    await update({ status: "done", proposed, explanation: result.explanation, error: null });
    log.info(`done: ${proposed.steps.length} steps`);
  } catch (e) {
    const error = signal.aborted ? "The worker shut down while working on this." : errorMessage(e);
    await update({ status: "failed", error });
    log.error("failed", e);
  }
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
