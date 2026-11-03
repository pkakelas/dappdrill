import { and, eq, inArray } from "drizzle-orm";
import type { Flow, PlanItem } from "@dappdrill/core";
import { apps, flowChanges, flows, scans, type Db } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import type { Logger } from "../log.js";
import { Persister } from "../persist.js";
import { buildTarget, loadApp, loadKnownFlows, replayChains } from "../target.js";
import { logEvents } from "./sink.js";

type Change = typeof flowChanges.$inferSelect;

/**
 * A flow-change of kind "retry": record a flow the scan planned but couldn't, with the
 * person's hint. A recorded flow is saved straight away, since it's the one the scan meant
 * to save; the hint joins the app's hints so later scans know it too.
 */
export async function runRetry(db: Db, engine: Engine, change: Change, log: Logger, signal: AbortSignal): Promise<{ error?: string }> {
  if (!change.scanId || !change.planItem) throw new Error("This retry has no planned flow.");
  const app = await loadApp(db, change.appId);
  const [scan] = await db.select().from(scans).where(and(eq(scans.id, change.scanId), eq(scans.appId, app.id)));
  const item = scan?.plan?.items.find((i) => i.name === change.planItem);
  if (!scan?.plan || !item) throw new Error("The planned flow is no longer in this scan.");

  // Flows it depends on run first, so the state it needs (a deposit, an open position) exists.
  const needs = scan.plan.items.filter((i) => item.dependsOn.includes(i.name)).flatMap((i) => (i.flowId ? [i.flowId] : []));
  const setup: Flow[] = needs.length
    ? (await db.select().from(flows).where(and(eq(flows.appId, app.id), inArray(flows.id, needs)))).map((r) => ({ ...r.definition, id: r.id, name: r.name }))
    : [];

  const hint = change.prompt.trim() || undefined;
  log.info(`retrying “${item.name}”${hint ? ` with the hint: ${hint}` : ""}`);
  const result = await engine.retryFlow(
    await buildTarget(db, app, app.settings, await replayChains(db, app)),
    scan.plan,
    item,
    { artifactsDir: artifactsDir("flow-changes", change.id), hint, setup, knownFlows: await loadKnownFlows(db, app.id) },
    logEvents(log),
    signal,
  );

  if (result.flow) {
    await new Persister(db, { appId: app.id, scanId: scan.id }).flow(result.flow);
    if (hint) {
      const hints = [app.settings.hints, `For “${item.name}”: ${hint}`].filter(Boolean).join("\n");
      await db.update(apps).set({ settings: { ...app.settings, hints } }).where(eq(apps.id, app.id));
    }
  }
  await setPlanItem(db, scan.id, result.item);
  await db
    .update(flowChanges)
    .set(result.flow ? { status: "done", proposed: result.flow, resolution: "accepted", error: null } : { status: "failed", error: result.item.note ?? "It couldn't be recorded." })
    .where(eq(flowChanges.id, change.id));
  return result.flow ? {} : { error: result.item.note };
}

/** Re-read the plan before writing, so two retries on the same scan don't undo each other. */
async function setPlanItem(db: Db, scanId: string, item: PlanItem): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ plan: scans.plan }).from(scans).where(eq(scans.id, scanId)).for("update");
    if (!row?.plan) return;
    const items = row.plan.items.map((i) => (i.name === item.name ? item : i));
    await tx.update(scans).set({ plan: { ...row.plan, items } }).where(eq(scans.id, scanId));
  });
}
