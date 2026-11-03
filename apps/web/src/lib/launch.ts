import "server-only";
import { DEFAULT_EDGE_CASES, newId, type EdgeCaseId } from "@dappdrill/core";
import { apps, db, flowChanges, flows, runBatches, scans, type Trigger } from "@dappdrill/db";
import { and, eq, max } from "drizzle-orm";
import { enqueue } from "./jobs";
import type { App } from "./session";

export class LaunchError extends Error {}

/** Inserts the scan row (next number for the app, settings snapshot), then enqueues it. */
export async function startScan(app: App, userId: string | null): Promise<string> {
  const scanId = newId("scan");
  await db().transaction(async (tx) => {
    // Lock the app row so two scans started together don't get the same number.
    await tx.select({ id: apps.id }).from(apps).where(eq(apps.id, app.id)).for("update");
    const [row] = await tx.select({ n: max(scans.number) }).from(scans).where(eq(scans.appId, app.id));
    await tx.insert(scans).values({
      id: scanId,
      appId: app.id,
      number: (row?.n ?? 0) + 1,
      status: "queued",
      trigger: "manual",
      triggeredBy: userId,
      settings: app.settings,
    });
  });
  await enqueue("scan.run", { scanId });
  return scanId;
}

export interface BatchRequest {
  flowIds?: string[];
  edgeCases?: EdgeCaseId[];
  variationId?: string;
  trigger?: Trigger;
}

/** Inserts a run_batches row and enqueues it. Defaults: every live flow, the app's edge cases. */
export async function startBatch(app: App, req: BatchRequest = {}): Promise<string> {
  let flowIds = req.flowIds;
  if (!flowIds) {
    const rows = await db()
      .select({ id: flows.id })
      .from(flows)
      .where(and(eq(flows.appId, app.id), eq(flows.archived, false)));
    flowIds = rows.map((r) => r.id);
  }
  if (flowIds.length === 0) throw new LaunchError("There are no flows to run yet.");
  const edgeCases = req.edgeCases?.length ? req.edgeCases : app.settings.edgeCases?.length ? app.settings.edgeCases : DEFAULT_EDGE_CASES;
  const batchId = newId("batch");
  await db().insert(runBatches).values({
    id: batchId,
    appId: app.id,
    trigger: req.trigger ?? "manual",
    status: "queued",
    request: { flowIds, edgeCases, ...(req.variationId ? { variationId: req.variationId } : {}) },
  });
  await enqueue("batch.run", { batchId });
  return batchId;
}

/** Plain-English change to a flow (or a new flow when flowId is null), processed by the worker. */
/** Records a flow the scan planned but couldn't, with the person's hint (may be empty). */
export async function startRetry(appId: string, scanId: string, planItem: string, hint: string, userId: string): Promise<string> {
  const changeId = newId("chg");
  await db().insert(flowChanges).values({ id: changeId, appId, kind: "retry", prompt: hint, scanId, planItem, status: "queued", createdBy: userId });
  await enqueue("flow-change.run", { changeId });
  return changeId;
}

export async function startFlowChange(appId: string, flowId: string | null, prompt: string, userId: string): Promise<string> {
  const changeId = newId("chg");
  await db().insert(flowChanges).values({ id: changeId, appId, flowId, kind: "describe", prompt, status: "queued", createdBy: userId });
  await enqueue("flow-change.run", { changeId });
  return changeId;
}
