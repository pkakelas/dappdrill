"use server";

import { Flow, newId, WalletProfileId } from "@dappdrill/core";
import { apps, db, flowChanges, flows, repairs, variations } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isHostVerified } from "@/lib/domains";
import { LaunchError, startBatch, startFlowChange } from "@/lib/launch";
import { requireApp } from "@/lib/session";

import type { ActionResult } from "@/lib/action-result";
export type { ActionResult };

const Id = z.string().min(1).max(100);

async function flowFor(flowId: string) {
  const [row] = await db().select().from(flows).where(eq(flows.id, Id.parse(flowId)));
  if (!row) throw new Error("Flow not found");
  const { app } = await requireApp(row.appId);
  return { flow: row, app };
}

export async function runAllAction(form: FormData): Promise<void> {
  const { app } = await requireApp(Id.parse(form.get("appId")));
  try {
    const batchId = await startBatch(app);
    redirect(`/apps/${app.id}/runs/${batchId}`);
  } catch (err) {
    if (err instanceof LaunchError) redirect(`/apps/${app.id}/flows?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
}

export async function setScheduleAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { app } = await requireApp(Id.parse(form.get("appId")));
  const raw = String(form.get("time") ?? "").trim();
  const off = form.get("off") === "1" || raw === "";
  if (!off) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return { error: "Use 24-hour time, like 07:00." };
    if (!(await isHostVerified(app.teamId, app.host))) {
      return { error: `Verify ${app.host} under Settings → Domain first. Scheduled runs only go to domains you've proven you own.` };
    }
  }
  await db().update(apps).set({ scheduleTime: off ? null : raw }).where(eq(apps.id, app.id));
  revalidatePath(`/apps/${app.id}`, "layout");
  return { ok: off ? "Schedule turned off." : `Runs every day at ${raw} UTC.` };
}

const Describe = z.object({
  appId: Id,
  flowId: Id.optional(),
  prompt: z.string().trim().min(5, "Describe the flow in a sentence or two.").max(2000),
});

/** Plain-English new flow or change; the worker walks it and proposes steps. */
export async function describeAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = Describe.safeParse({ appId: form.get("appId"), flowId: form.get("flowId") || undefined, prompt: form.get("prompt") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { app, user } = await requireApp(parsed.data.appId);
  if (parsed.data.flowId) await flowFor(parsed.data.flowId);
  await startFlowChange(app.id, parsed.data.flowId ?? null, parsed.data.prompt, user.id);
  revalidatePath(parsed.data.flowId ? `/apps/${app.id}/flows/${parsed.data.flowId}` : `/apps/${app.id}/flows`);
  return { ok: "Working on it. The proposal shows up here when it's ready." };
}

export async function resolveChangeAction(form: FormData): Promise<void> {
  const changeId = Id.parse(form.get("changeId"));
  const accept = form.get("accept") === "1";
  const [change] = await db().select().from(flowChanges).where(eq(flowChanges.id, changeId));
  if (!change) return;
  const { app } = await requireApp(change.appId);
  let target = change.flowId;
  if (accept) {
    const proposed = Flow.parse(change.proposed);
    if (change.flowId) {
      await db().update(flows).set({ definition: { ...proposed, id: change.flowId }, name: proposed.name, updatedAt: new Date() }).where(eq(flows.id, change.flowId));
    } else {
      const id = newId("flow");
      await db().insert(flows).values({ id, appId: app.id, name: proposed.name, definition: { ...proposed, id, origin: proposed.origin ?? "described" } });
      target = id;
    }
  }
  await db().update(flowChanges).set({ resolution: accept ? "accepted" : "dismissed" }).where(eq(flowChanges.id, change.id));
  revalidatePath(`/apps/${app.id}`, "layout");
  if (accept && target && !change.flowId) redirect(`/apps/${app.id}/flows/${target}`);
}

export async function resolveRepairAction(form: FormData): Promise<void> {
  const repairId = Id.parse(form.get("repairId"));
  const accept = form.get("accept") === "1";
  const [repair] = await db().select().from(repairs).where(eq(repairs.id, repairId));
  if (!repair) return;
  const { flow, app } = await flowFor(repair.flowId);
  if (accept) {
    const proposed = Flow.parse(repair.proposed);
    await db().update(flows).set({ definition: { ...proposed, id: flow.id }, name: proposed.name, updatedAt: new Date() }).where(eq(flows.id, flow.id));
  }
  await db().update(repairs).set({ status: accept ? "accepted" : "dismissed" }).where(eq(repairs.id, repair.id));
  revalidatePath(`/apps/${app.id}`, "layout");
}

/** Saves a whole flow definition (step editor and Code tab). */
export async function saveFlowAction(flowId: string, json: string): Promise<ActionResult> {
  const { flow, app } = await flowFor(flowId);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { error: "That isn't valid JSON." };
  }
  const parsed = Flow.safeParse(value);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: i ? `${i.path.join(".") || "flow"}: ${i.message}` : "That isn't a valid flow." };
  }
  const def = { ...parsed.data, id: flow.id };
  await db().update(flows).set({ definition: def, name: def.name, updatedAt: new Date() }).where(eq(flows.id, flow.id));
  revalidatePath(`/apps/${app.id}`, "layout");
  return { ok: "Saved." };
}

export async function duplicateFlowAction(form: FormData): Promise<void> {
  const { flow, app } = await flowFor(String(form.get("flowId")));
  const id = newId("flow");
  const name = `${flow.name} (copy)`;
  await db().insert(flows).values({ id, appId: app.id, name, definition: { ...flow.definition, id, name } });
  const vars = await db().select().from(variations).where(eq(variations.flowId, flow.id));
  if (vars.length) await db().insert(variations).values(vars.map((v) => ({ ...v, id: newId("var"), flowId: id, createdAt: undefined })));
  redirect(`/apps/${app.id}/flows/${id}`);
}

export async function archiveFlowAction(form: FormData): Promise<void> {
  const { flow, app } = await flowFor(String(form.get("flowId")));
  await db().update(flows).set({ archived: true, updatedAt: new Date() }).where(eq(flows.id, flow.id));
  revalidatePath(`/apps/${app.id}`, "layout");
  redirect(`/apps/${app.id}/flows`);
}

const VariationInput = z.object({
  flowId: Id,
  name: z.string().trim().min(1, "Give the variation a name.").max(80),
  inputs: z.record(z.string(), z.string()),
  wallet: WalletProfileId.optional(),
  chainId: z.coerce.number().int().positive().optional(),
  account: z.enum(["A", "B"]).optional(),
});

export async function addVariationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const inputs: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("input:") && String(v).trim() !== "") inputs[k.slice(6)] = String(v).trim();
  const parsed = VariationInput.safeParse({
    flowId: form.get("flowId"),
    name: form.get("name"),
    inputs,
    wallet: form.get("wallet") || undefined,
    chainId: form.get("chainId") || undefined,
    account: form.get("account") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { app } = await flowFor(parsed.data.flowId);
  await db().insert(variations).values({ id: newId("var"), ...parsed.data });
  revalidatePath(`/apps/${app.id}/flows/${parsed.data.flowId}`);
  return { ok: "Added." };
}

export async function removeVariationAction(form: FormData): Promise<void> {
  const id = Id.parse(form.get("variationId"));
  const [v] = await db().select().from(variations).where(eq(variations.id, id));
  if (!v) return;
  const { app } = await flowFor(v.flowId);
  await db().delete(variations).where(and(eq(variations.id, id), eq(variations.flowId, v.flowId)));
  revalidatePath(`/apps/${app.id}/flows/${v.flowId}`);
}
