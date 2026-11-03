import { apps, db, scans } from "@dappdrill/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { makePanelHref } from "@/components/report/ctx";
import { ResultPanel } from "@/components/report/panels";
import { headline, ReportBody } from "@/components/report/report-body";
import { Logo } from "@/components/ui";
import { hostFromUrl, minutesBetween, plural, shortDate } from "@/lib/format";
import { loadPanel, loadResults, summarize } from "@/lib/report";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ scan?: string; panel?: string; cat?: string }> };

export const metadata: Metadata = { title: "Shared report", robots: { index: false, follow: false } };

const Token = z.string().regex(/^[\w-]{16,64}$/);

async function load(token: string, scanId?: string) {
  const t = Token.safeParse(token);
  if (!t.success) notFound();
  const [app] = await db().select().from(apps).where(eq(apps.shareToken, t.data));
  if (!app) notFound();
  const finished = inArray(scans.status, ["done", "stopped"]);
  const [scan] = await db()
    .select()
    .from(scans)
    .where(and(eq(scans.appId, app.id), finished, scanId ? eq(scans.id, scanId) : undefined))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  return { app, scan };
}

/** Public, read-only report for anyone holding the app's share link. */
export default async function SharePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { scan: scanId, panel, cat } = await searchParams;
  const { app, scan } = await load(token, scanId);
  const path = `/share/${token}`;
  const host = hostFromUrl(app.url);

  return (
    <>
      <header className="border-b border-line">
        <div className="page flex items-center justify-between gap-3 py-3.5">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <Logo />
            <span className="font-serif text-[20px] tracking-[-0.02em]">DappDrill</span>
          </Link>
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">Shared report · read-only</span>
        </div>
      </header>
      <main>{scan ? <Report app={app} scan={scan} path={path} token={token} panel={panel} cat={cat} host={host} /> : <NoReport name={app.name} />}</main>
    </>
  );
}

async function Report({ app, scan, path, token, panel, cat, host }: { app: typeof apps.$inferSelect; scan: typeof scans.$inferSelect; path: string; token: string; panel?: string; cat?: string; host: string }) {
  const [results, rawPanel] = await Promise.all([loadResults({ scanId: scan.id }), loadPanel(app.id, panel)]);
  // Only panels that belong to this scan are visible through the share link.
  const panelData = rawPanel?.row.scanId === scan.id ? rawPanel : null;
  const ctx = { appId: app.id, panelHref: makePanelHref(path, { scan: scan.id, cat }), readOnly: true, share: token };
  const s = summarize(results);
  return (
    <div className="page flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <span className="crumbs">
          {app.name} · Scan #{scan.number} · <span className="font-mono">{host}</span> · {shortDate(scan.createdAt)}
          {scan.finishedAt && `, ${minutesBetween(scan.startedAt ?? scan.createdAt, scan.finishedAt)}`}
        </span>
        <h1 className="h1">{headline(s)}</h1>
        <p className="m-0 text-[15px] text-ink-3">
          {plural(s.flowCount, "flow")} found, {plural(s.edgeCasesTried, "wallet edge case")} tried, {plural(s.reviewCount, "signature request")} reviewed.
        </p>
      </header>
      <ReportBody results={results} ctx={ctx} cat={cat} filterHref={(c) => makePanelHref(path, { scan: scan.id, cat: c === "all" ? undefined : c })(null)} />
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}

function NoReport({ name }: { name: string }) {
  return (
    <div className="page">
      <div className="card px-6 py-8 text-center">
        <p className="m-0 text-[15px] font-medium">{name} has no finished scan to show yet.</p>
      </div>
    </div>
  );
}
