import { describeBlock } from "@dappdrill/core";
import { db, scanEvents, scans } from "@dappdrill/db";
import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { makePanelHref } from "@/components/report/ctx";
import { ResultPanel } from "@/components/report/panels";
import { headline, ReportBody } from "@/components/report/report-body";
import { ShareControl } from "@/components/report/share-control";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { LiveView } from "@/components/scan/live-view";
import { shortDate, minutesBetween, hostFromUrl, plural } from "@/lib/format";
import type { LiveEvent, ScanSnapshot } from "@/lib/live";
import { githubRepo } from "@/lib/queries";
import { loadPanel, loadResults, summarize } from "@/lib/report";
import { requireApp } from "@/lib/session";

type Props = { params: Promise<{ appId: string; scanId: string }>; searchParams: Promise<{ panel?: string; cat?: string }> };

async function getScan(appId: string, scanId: string) {
  const [scan] = await db().select().from(scans).where(and(eq(scans.id, scanId), eq(scans.appId, appId)));
  if (!scan) notFound();
  return scan;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { appId, scanId } = await params;
  const { app } = await requireApp(appId);
  const scan = await getScan(app.id, scanId);
  return { title: `Scan #${scan.number} · ${app.name}` };
}

export default async function ScanPage({ params, searchParams }: Props) {
  const { appId, scanId } = await params;
  const { panel, cat } = await searchParams;
  const { app } = await requireApp(appId);
  const scan = await getScan(app.id, scanId);
  const host = hostFromUrl(app.url);
  const path = `/apps/${app.id}/scans/${scan.id}`;

  if (scan.status === "queued" || scan.status === "running") {
    const rows = await db().select().from(scanEvents).where(eq(scanEvents.scanId, scan.id)).orderBy(asc(scanEvents.id));
    const events: LiveEvent[] = rows.slice(-2000).map((r) => ({ id: r.id, at: r.createdAt.toISOString(), event: r.event }));
    const snapshot: ScanSnapshot = {
      status: scan.status,
      stages: scan.stages,
      liveFrame: scan.liveFrame,
      pages: scan.pages.length,
      costUsd: scan.costUsd,
      startedAt: scan.startedAt?.toISOString() ?? null,
      stopRequested: scan.stopRequested,
      error: scan.error,
      chains: scan.chains.map((c) => ({ id: c.id, name: c.name, mode: c.mode })),
    };
    return (
      <div className="page flex flex-col gap-2">
        <nav className="text-sm text-muted-foreground [&_a]:hover:text-foreground">
          <Link href={`/apps/${app.id}/runs`}>Runs</Link> / Scan #{scan.number}
        </nav>
        <LiveView scanId={scan.id} host={host} initialEvents={events} initialSnapshot={snapshot} frameBase={`/api/artifacts/scans/${scan.id}`} />
      </div>
    );
  }

  const [results, repo, panelData] = await Promise.all([loadResults({ scanId: scan.id }), githubRepo(app.teamId), loadPanel(app.id, panel)]);
  const ctx = { appId: app.id, panelHref: makePanelHref(path, { cat }), readOnly: false, githubRepo: repo };
  const s = summarize(results);

  return (
    <div className="page flex flex-col gap-6">
      <div>
        <nav className="mb-2 text-sm text-muted-foreground [&_a]:hover:text-foreground">
          <Link href={`/apps/${app.id}/runs`}>Runs</Link> / Scan #{scan.number} · <span className="font-mono">{host}</span> · {shortDate(scan.createdAt)}
          {scan.finishedAt && `, ${minutesBetween(scan.startedAt ?? scan.createdAt, scan.finishedAt)}`}
        </nav>
        <PageHeader
          title={headline(s)}
          description={`${plural(s.flowCount, "flow")} found, ${plural(s.edgeCasesTried, "wallet edge case")} tried, ${plural(s.reviewCount, "signature request")} reviewed.`}
          actions={
            <>
              <ShareControl appId={app.id} shareToken={app.shareToken} scanId={scan.id} />
              <Button asChild size="sm">
                <Link href={`/apps/${app.id}/flows`}>Saved flows</Link>
              </Button>
            </>
          }
        />
      </div>

      {scan.status !== "done" && (
        <p role="status" className={scan.status === "failed" ? "rounded-lg border border-bad-line bg-bad-soft px-4 py-3 text-bad-ink" : "rounded-lg border bg-muted/50 px-4 py-3"}>
          {scan.status === "failed" ? `This scan failed${scan.error ? `: ${scan.error}` : "."} Results below are what it found before stopping.` : "This scan was stopped early. Results below are what it found until then."}
        </p>
      )}

      {scan.blocked && (
        <div role="note" className="flex flex-col gap-1 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-warn-ink">
          <strong className="font-semibold">{describeBlock(scan.blocked)}, so exploring stopped there.</strong>
          <span>
            DappDrill doesn&apos;t solve CAPTCHAs. If this is your app, add an allowlist header in{" "}
            <Link href={`/new?app=${app.id}`} className="underline">
              scan settings
            </Link>{" "}
            and let it through your bot protection. <Link href="/bot" className="underline">How to set it up</Link>
          </span>
        </div>
      )}

      <ReportBody results={results} ctx={ctx} cat={cat} filterHref={(c) => makePanelHref(path, { cat: c === "all" ? undefined : c })(null)} />
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
