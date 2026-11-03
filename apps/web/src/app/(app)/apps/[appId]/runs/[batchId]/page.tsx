import { edgeCaseInfo } from "@dappdrill/core";
import { db, runBatches, variations } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { stopBatchAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { makePanelHref } from "@/components/report/ctx";
import { ResultPanel } from "@/components/report/panels";
import { ActionButton, JobStatus, Mono, Notice, PageHeader } from "@/components/ui";
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
    <div className="page gap-8">
      {active && <AutoRefresh every={3000} />}
      <PageHeader
        crumbs={[{ label: "Runs", href: `/apps/${app.id}/runs` }, { label: `${TRIGGER_LABEL[batch.trigger]} run` }]}
        title={
          active
            ? batch.stopRequested
              ? "Stopping…"
              : batch.status === "queued"
                ? "Waiting for a worker…"
                : "Running…"
            : batch.status === "failed"
              ? "This run failed"
              : batch.status === "stopped"
                ? `Stopped early. ${headline(s)}`
                : headline(s)
        }
        status={!active && batch.status === "done" ? undefined : <JobStatus status={batch.status} />}
        sub={
          <>
            {plural(batch.request.flowIds.length, "flow")} × {cases}
            {variation && ` · variation “${variation.name}”`}
            {(batch.request.commit || batch.request.branch) && (
              <>
                {" · "}
                <Mono className="text-sm">
                  {batch.request.commit?.slice(0, 7)} {batch.request.branch}
                </Mono>
              </>
            )}
            <span className="meta block">
              {dateTime(batch.createdAt)}
              {batch.finishedAt && ` · took ${minutesBetween(batch.startedAt ?? batch.createdAt, batch.finishedAt)}`}
            </span>
          </>
        }
        actions={
          active &&
          !batch.stopRequested && (
            <ActionButton action={stopBatchAction} fields={{ batchId: batch.id }} className="btn-sm" confirm="Stop the run?">
              Stop
            </ActionButton>
          )
        }
      />
      {batch.error && (
        <Notice tone="bad" role="alert" title="The run stopped with an error">
          {batch.error}
        </Notice>
      )}
      <ReportBody batch results={results} ctx={ctx} cat={cat} filterHref={(c) => makePanelHref(path, { cat: c === "all" ? undefined : c })(null)} />
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
