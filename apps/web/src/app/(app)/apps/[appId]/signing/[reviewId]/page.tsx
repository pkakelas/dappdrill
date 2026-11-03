import { db, flows, scans, signingReviews } from "@dappdrill/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { makePanelHref } from "@/components/report/ctx";
import { SigningReviewView } from "@/components/report/signing-review";
import { PageHeader, type Crumb } from "@/components/ui";
import { githubRepo } from "@/lib/queries";
import { requireApp } from "@/lib/session";

type Props = { params: Promise<{ appId: string; reviewId: string }> };

export const metadata: Metadata = { title: "Signing review" };

export default async function SigningPage({ params }: Props) {
  const { appId, reviewId } = await params;
  const { app } = await requireApp(appId);
  const [row] = await db().select().from(signingReviews).where(and(eq(signingReviews.id, reviewId), eq(signingReviews.appId, app.id)));
  if (!row) notFound();
  const [flow, scan, siblings, repo] = await Promise.all([
    row.flowId ? db().select({ id: flows.id, name: flows.name }).from(flows).where(eq(flows.id, row.flowId)).then((r) => r[0]) : undefined,
    row.scanId ? db().select({ id: scans.id, number: scans.number }).from(scans).where(eq(scans.id, row.scanId)).then((r) => r[0]) : undefined,
    row.data.runId
      ? db().select().from(signingReviews).where(and(eq(signingReviews.appId, app.id), sql`${signingReviews.data}->>'runId' = ${row.data.runId}`)).orderBy(asc(signingReviews.createdAt))
      : Promise.resolve([]),
    githubRepo(app.teamId),
  ]);
  const index = siblings.findIndex((s) => s.id === row.id);
  // Sibling links go to their full pages here, not panels.
  const ctx = { appId: app.id, panelHref: (p: string | null) => (p?.startsWith("review.") ? `/apps/${app.id}/signing/${p.slice(7)}` : makePanelHref(`/apps/${app.id}/signing/${row.id}`, {})(null)), readOnly: false, githubRepo: repo };

  const crumbs: Crumb[] = [
    scan ? { label: `Scan #${scan.number}`, href: `/apps/${app.id}/scans/${scan.id}` } : row.batchId ? { label: "Run", href: `/apps/${app.id}/runs/${row.batchId}` } : { label: "Signing review" },
    ...(flow ? [{ label: flow.name, href: `/apps/${app.id}/flows/${flow.id}` }] : []),
    ...(siblings.length > 1 && index >= 0 ? [{ label: `Request ${index + 1} of ${siblings.length}` }] : []),
  ];

  return (
    <div className="page gap-8">
      <PageHeader crumbs={crumbs} title={row.data.title} />
      <SigningReviewView row={row} ctx={ctx} siblings={siblings} />
    </div>
  );
}
