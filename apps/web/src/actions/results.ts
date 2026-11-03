"use server";

import { EdgeCaseId } from "@dappdrill/core";
import { apps, db, issues, runBatches, signingReviews } from "@dappdrill/db";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LaunchError, startBatch } from "@/lib/launch";
import { requireApp } from "@/lib/session";

const Id = z.string().min(1).max(100);

const Rerun = z.object({
  appId: Id,
  flowId: Id.optional(),
  edgeCase: EdgeCaseId.optional(),
  variationId: Id.optional(),
});

/** Re-run one flow (optionally one edge case / variation) as a new run batch. */
export async function rerunAction(form: FormData): Promise<void> {
  const input = Rerun.parse({
    appId: form.get("appId"),
    flowId: form.get("flowId") || undefined,
    edgeCase: form.get("edgeCase") || undefined,
    variationId: form.get("variationId") || undefined,
  });
  const { app } = await requireApp(input.appId);
  let batchId: string;
  try {
    batchId = await startBatch(app, {
      flowIds: input.flowId ? [input.flowId] : undefined,
      edgeCases: input.edgeCase ? [input.edgeCase] : undefined,
      variationId: input.variationId,
    });
  } catch (err) {
    if (err instanceof LaunchError) redirect(`/apps/${app.id}/flows?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`/apps/${app.id}/runs/${batchId}`);
}

async function reviewFor(reviewId: string) {
  const [row] = await db().select().from(signingReviews).where(eq(signingReviews.id, Id.parse(reviewId)));
  if (!row) throw new Error("Signing review not found");
  await requireApp(row.appId);
  return row;
}

/** Future runs compare this signing request against this review. */
export async function acceptBaselineAction(form: FormData): Promise<void> {
  const row = await reviewFor(String(form.get("reviewId")));
  await db().transaction(async (tx) => {
    await tx
      .update(signingReviews)
      .set({ isBaseline: false })
      .where(and(eq(signingReviews.appId, row.appId), eq(signingReviews.fingerprint, row.fingerprint), ne(signingReviews.id, row.id)));
    await tx.update(signingReviews).set({ isBaseline: true }).where(eq(signingReviews.id, row.id));
  });
  revalidatePath(`/apps/${row.appId}`, "layout");
}

/** "This is expected": ignore the issues raised about this signing request. */
export async function markExpectedAction(form: FormData): Promise<void> {
  const row = await reviewFor(String(form.get("reviewId")));
  await db()
    .update(issues)
    .set({ status: "ignored" })
    .where(
      and(
        eq(issues.appId, row.appId),
        or(
          sql`${issues.data}->'evidence'->>'signingReviewId' = ${row.data.id}`,
          sql`${issues.data}->'evidence'->>'signingReviewId' = ${row.id}`,
        ),
      ),
    );
  revalidatePath(`/apps/${row.appId}`, "layout");
}

export async function setIssueStatusAction(form: FormData): Promise<void> {
  const issueId = Id.parse(form.get("issueId"));
  const status = z.enum(["open", "ignored"]).parse(form.get("status"));
  const [row] = await db().select({ appId: issues.appId }).from(issues).where(eq(issues.id, issueId));
  if (!row) return;
  await requireApp(row.appId);
  await db().update(issues).set({ status }).where(eq(issues.id, issueId));
  revalidatePath(`/apps/${row.appId}`, "layout");
}

/** Create or revoke the app's public, read-only report link. */
export async function setShareAction(form: FormData): Promise<void> {
  const { app } = await requireApp(Id.parse(form.get("appId")));
  const on = form.get("on") === "1";
  await db()
    .update(apps)
    .set({ shareToken: on ? randomBytes(18).toString("base64url") : null })
    .where(eq(apps.id, app.id));
  revalidatePath(`/apps/${app.id}`, "layout");
}

/** Asks the worker to stop a running batch (it polls run_batches.stop_requested between runs). */
export async function stopBatchAction(form: FormData): Promise<void> {
  const batchId = Id.parse(form.get("batchId"));
  const [row] = await db().select({ appId: runBatches.appId }).from(runBatches).where(eq(runBatches.id, batchId));
  if (!row) return;
  await requireApp(row.appId);
  await db().update(runBatches).set({ stopRequested: true }).where(eq(runBatches.id, batchId));
  revalidatePath(`/apps/${row.appId}/runs/${batchId}`);
}
