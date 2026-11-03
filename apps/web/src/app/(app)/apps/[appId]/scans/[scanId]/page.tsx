import { describeBlock, missesChain, stallReasons } from "@dappdrill/core";
import { db, flowChanges, scanEvents, scans } from "@dappdrill/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { makePanelHref } from "@/components/report/ctx";
import { ResultPanel } from "@/components/report/panels";
import { headline, ReportBody } from "@/components/report/report-body";
import { ShareControl } from "@/components/report/share-control";
import { AutoRefresh } from "@/components/auto-refresh";
import { Coverage } from "@/components/scan/coverage";
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
        <nav className="crumbs">
          <Link href={`/apps/${app.id}/runs`}>Runs</Link> / Scan #{scan.number}
        </nav>
        <LiveView scanId={scan.id} host={host} initialEvents={events} initialSnapshot={snapshot} frameBase={`/api/artifacts/scans/${scan.id}`} />
      </div>
    );
  }

  const [results, repo, panelData, retries] = await Promise.all([
    loadResults({ scanId: scan.id }),
    githubRepo(app.teamId),
    loadPanel(app.id, panel),
    db()
      .select({ planItem: flowChanges.planItem })
      .from(flowChanges)
      .where(and(eq(flowChanges.scanId, scan.id), inArray(flowChanges.status, ["queued", "running"]))),
  ]);
  const retrying = new Set(retries.flatMap((r) => (r.planItem ? [r.planItem] : [])));
  const ctx = { appId: app.id, panelHref: makePanelHref(path, { cat }), readOnly: false, githubRepo: repo };
  const s = summarize(results);

  return (
    <div className="page flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="crumbs">
            <Link href={`/apps/${app.id}/runs`}>Runs</Link> / Scan #{scan.number} · <span className="font-mono">{host}</span> · {shortDate(scan.createdAt)}
            {scan.finishedAt && `, ${minutesBetween(scan.startedAt ?? scan.createdAt, scan.finishedAt)}`}
          </span>
          <h1 className="h1">{headline(s)}</h1>
          <p className="m-0 text-[15px] text-ink-3">
            {plural(s.flowCount, "flow")} found, {plural(s.edgeCasesTried, "wallet edge case")} tried, {plural(s.reviewCount, "signature request")} reviewed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ShareControl appId={app.id} shareToken={app.shareToken} scanId={scan.id} />
          <Link href={`/apps/${app.id}/flows`} className="btn btn-sm btn-primary">
            Saved flows
          </Link>
        </div>
      </header>

      {scan.status !== "done" && (
        <p role="status" className={scan.status === "failed" ? "m-0 rounded-xl border border-bad-line bg-bad-soft px-5 py-4 text-sm text-bad-ink" : "m-0 rounded-xl border border-line bg-sub px-5 py-4 text-sm text-ink-2"}>
          {scan.status === "failed" ? `This scan failed${scan.error ? `: ${scan.error}` : "."} Results below are what it found before stopping.` : "This scan was stopped early. Results below are what it found until then."}
        </p>
      )}

      {scan.blocked && (
        <div role="note" className="flex flex-col gap-1.5 rounded-xl border border-warn-line bg-warn-soft px-5 py-4 text-sm text-warn-ink">
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

      {scan.stalled && missesChain(scan.stalled) && (
        <div role="note" className="flex flex-col gap-1.5 rounded-xl border border-warn-line bg-warn-soft px-5 py-4 text-sm text-warn-ink">
          <strong className="font-semibold">Your app needs a chain the test wallet couldn&apos;t use, so exploring stopped there.</strong>
          <ul className="m-0 flex flex-col gap-1 pl-5">
            {stallReasons(scan.stalled).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <span>
            Add the chain with an RPC that answers for it in{" "}
            <Link href={`/new?app=${app.id}`} className="underline">
              scan settings
            </Link>
            , then scan again.
          </span>
        </div>
      )}

      {scan.stalled && !missesChain(scan.stalled) && (
        <div role="note" className="flex flex-col gap-1.5 rounded-xl border border-warn-line bg-warn-soft px-5 py-4 text-sm text-warn-ink">
          <strong className="font-semibold">Your app&apos;s data didn&apos;t load on the test chain, so there was nothing to test.</strong>
          <ul className="m-0 flex flex-col gap-1 pl-5">
            {stallReasons(scan.stalled).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <span>
            Point those reads at the fork, or use{" "}
            <Link href={`/new?app=${app.id}`} className="underline">
              Test setup
            </Link>{" "}
            in scan settings to turn on a fork mode or answer a request with a fixed body.{" "}
            <Link href="/fork" className="underline">
              What to change
            </Link>
          </span>
        </div>
      )}

      {scan.plan && <Coverage appId={app.id} scanId={scan.id} plan={scan.plan} retrying={retrying} skipped={new Set(app.settings.skipFlows ?? [])} />}
      {retrying.size > 0 && <AutoRefresh every={5000} />}

      <ReportBody results={results} ctx={ctx} cat={cat} filterHref={(c) => makePanelHref(path, { cat: c === "all" ? undefined : c })(null)} />
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
