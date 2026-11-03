import { edgeCaseInfo } from "@dappdrill/core";
import { db, runBatches, variations } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { stopBatchAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { makePanelHref } from "@/components/report/ctx";
import { ResultPanel } from "@/components/report/panels";
import { headline, ReportBody } from "@/components/report/report-body";
import { dateTime, minutesBetween, plural, TRIGGER_LABEL } from "@/lib/format";
import { githubRepo } from "@/lib/queries";
import { loadPanel, loadResults, summarize } from "@/lib/report";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Run" };

type Props = { params: Promise<{ appId: string; batchId: string }>; searchParams: Promise<{ panel?: string; cat?: string }> };

export default async function BatchPage({ params, searchParams }: Props) {
  const { appId, batchId } = await params;
  const { panel, cat } = await searchParams;
  const { app } = await requireApp(appId);
  const [batch] = await db().select().from(runBatches).where(and(eq(runBatches.id, batchId), eq(runBatches.appId, app.id)));
  if (!batch) notFound();
  if (batch.scanId) redirect(`/apps/${app.id}/scans/${batch.scanId}`);
  const path = `/apps/${app.id}/runs/${batch.id}`;
  const [results, repo, panelData, variation] = await Promise.all([
    loadResults({ batchId: batch.id }),
    githubRepo(app.teamId),
    loadPanel(app.id, panel),
    batch.request.variationId ? db().select().from(variations).where(eq(variations.id, batch.request.variationId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const ctx = { appId: app.id, panelHref: makePanelHref(path, { cat }), readOnly: false, githubRepo: repo };
  const s = summarize(results);
  const active = batch.status === "queued" || batch.status === "running";
  const cases = batch.request.edgeCases.map((e) => edgeCaseInfo(e).label).join(", ");

  return (
    <div className="page flex flex-col gap-8">
      {active && <AutoRefresh every={3000} />}
      <header className="flex flex-col gap-2">
        <span className="crumbs">
          <Link href={`/apps/${app.id}/runs`}>Runs</Link> / {TRIGGER_LABEL[batch.trigger]} run · {dateTime(batch.createdAt)}
          {batch.finishedAt && `, ${minutesBetween(batch.startedAt ?? batch.createdAt, batch.finishedAt)}`}
        </span>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="h1">
            {active ? (batch.stopRequested ? "Stopping…" : batch.status === "queued" ? "Waiting for a worker…" : "Running…") : batch.status === "failed" ? "This run failed" : batch.status === "stopped" ? `Stopped early. ${headline(s)}` : headline(s)}
          </h1>
          {active && !batch.stopRequested && (
            <form action={stopBatchAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <button type="submit" className="btn btn-sm">
                Stop
              </button>
            </form>
          )}
        </div>
        <p className="m-0 text-[15px] text-ink-3">
          {plural(batch.request.flowIds.length, "flow")} × {cases}
          {variation && ` · variation “${variation.name}”`}
          {(batch.request.commit || batch.request.branch) && (
            <>
              {" · "}
              <span className="font-mono text-sm">
                {batch.request.commit?.slice(0, 7)} {batch.request.branch}
              </span>
            </>
          )}
        </p>
        {batch.error && <p className="m-0 rounded-xl border border-bad-line bg-bad-soft px-5 py-4 text-sm text-bad-ink">{batch.error}</p>}
      </header>
      <ReportBody batch results={results} ctx={ctx} cat={cat} filterHref={(c) => makePanelHref(path, { cat: c === "all" ? undefined : c })(null)} />
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
