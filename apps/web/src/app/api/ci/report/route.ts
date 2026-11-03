import { FlowRun, Issue, newId, SigningReview } from "@dappdrill/core";
import { db, flows, issues, runBatches, runs, signingReviews } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/lib/env";
import { ciAuth, json, readJson } from "@/lib/ci";

export const dynamic = "force-dynamic";

const Report = z.object({
  commit: z.string().max(80).optional(),
  branch: z.string().max(200).optional(),
  runs: z.array(FlowRun).max(5000),
  issues: z.array(Issue).max(5000),
  signingReviews: z.array(SigningReview).max(5000),
});

/** Stores a CI run (CLI / GitHub Action) as a finished run batch with its results. */
export async function POST(req: Request) {
  const auth = await ciAuth(req, { needsVerifiedDomain: true });
  if ("error" in auth) return auth.error;
  const { app } = auth;
  let report: z.infer<typeof Report>;
  try {
    const parsed = Report.safeParse(await readJson(req));
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return json({ error: `Invalid report: ${i ? `${i.path.join(".")}: ${i.message}` : "bad body"}` }, 400);
    }
    report = parsed.data;
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  // Only reference flows this app owns; anything else is stored with flow_id null.
  const flowIds = [...new Set(report.runs.map((r) => r.flowId))];
  const owned = new Set(
    flowIds.length ? (await db().select({ id: flows.id }).from(flows).where(and(eq(flows.appId, app.id), inArray(flows.id, flowIds)))).map((f) => f.id) : [],
  );
  const ref = (id?: string) => (id && owned.has(id) ? id : null);
  const ignored = new Set(
    (await db().select({ fp: issues.fingerprint }).from(issues).where(and(eq(issues.appId, app.id), eq(issues.status, "ignored")))).map((r) => r.fp),
  );
  const times = report.runs.flatMap((r) => [Date.parse(r.startedAt), Date.parse(r.finishedAt)]).filter(Number.isFinite);
  const batchId = newId("batch");

  await db().transaction(async (tx) => {
    await tx.insert(runBatches).values({
      id: batchId,
      appId: app.id,
      trigger: "ci",
      status: "done",
      request: {
        flowIds: flowIds.filter((id) => owned.has(id)),
        edgeCases: [...new Set(report.runs.map((r) => r.edgeCase))],
        ...(report.commit ? { commit: report.commit } : {}),
        ...(report.branch ? { branch: report.branch } : {}),
      },
      startedAt: times.length ? new Date(Math.min(...times)) : new Date(),
      finishedAt: times.length ? new Date(Math.max(...times)) : new Date(),
    });
    if (report.runs.length)
      await tx
        .insert(runs)
        .values(report.runs.map((r) => ({ id: r.id, appId: app.id, batchId, flowId: ref(r.flowId), edgeCase: r.edgeCase, status: r.status, result: r })))
        .onConflictDoNothing();
    if (report.issues.length)
      await tx
        .insert(issues)
        .values(
          report.issues.map((i) => ({
            id: i.id,
            appId: app.id,
            batchId,
            runId: i.runId ?? null,
            flowId: ref(i.flowId),
            fingerprint: i.fingerprint,
            severity: i.severity,
            category: i.category,
            title: i.title,
            data: i,
            status: ignored.has(i.fingerprint) ? ("ignored" as const) : ("open" as const),
          })),
        )
        .onConflictDoNothing();
    if (report.signingReviews.length)
      await tx
        .insert(signingReviews)
        .values(report.signingReviews.map((s) => ({ id: s.id, appId: app.id, batchId, flowId: ref(s.flowId), fingerprint: s.fingerprint, verdict: s.verdict, data: s })))
        .onConflictDoNothing();
  });

  return json({ batchId, url: `${env.appUrl}/apps/${app.id}/runs/${batchId}` }, 201);
}
