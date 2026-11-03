import { db, flows, runBatches, scans } from "@dappdrill/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ArrowRight, ChevronRight, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ActivityItem, buildActivity } from "@/components/activity";
import { FlowList, flowTableData } from "@/components/flows/flow-list";
import { makePanelHref } from "@/components/report/ctx";
import { ResultPanel } from "@/components/report/panels";
import { Empty, HealthBadge, ItemList, ListItem, PageHeader, RowLink, SeverityTag } from "@/components/common";
import { Button } from "@/components/ui/button";
import { ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { activityOutcomes, fixedSince, githubRepo, latestScan, latestScreenshot, openIssues } from "@/lib/queries";
import { artifactOwner, artifactUrl } from "@/lib/artifacts";
import { loadPanel } from "@/lib/report";
import { edgeCaseInfo, healthOfIssues } from "@dappdrill/core";
import { requireApp } from "@/lib/session";

type Props = {
  params: Promise<{ appId: string }>;
  searchParams: Promise<{ panel?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

export default async function OverviewPage({ params, searchParams }: Props) {
  const { appId } = await params;
  const { panel } = await searchParams;
  const { app } = await requireApp(appId);
  const path = `/apps/${app.id}`;

  const [current, finished, issues, batches, flowRows, repo, panelData, scanRows, shotRow] = await Promise.all([
    latestScan(app.id),
    latestScan(app.id, true),
    openIssues(app.id),
    db()
      .select()
      .from(runBatches)
      .where(and(eq(runBatches.appId, app.id), isNull(runBatches.scanId)))
      .orderBy(desc(runBatches.createdAt))
      .limit(SHOWN),
    db()
      .select()
      .from(flows)
      .where(and(eq(flows.appId, app.id), eq(flows.archived, false)))
      .orderBy(asc(flows.createdAt)),
    githubRepo(app.teamId),
    loadPanel(app.id, panel),
    db().select().from(scans).where(eq(scans.appId, app.id)).orderBy(desc(scans.createdAt)).limit(SHOWN),
    latestScreenshot(app.id),
  ]);
  const [flowData, fixed, outcomes] = await Promise.all([
    flowTableData(flowRows),
    fixedSince(app.id, finished?.createdAt),
    activityOutcomes(
      scanRows.map((s) => s.id),
      batches.map((b) => b.id),
    ),
  ]);
  const ctx = {
    appId: app.id,
    panelHref: makePanelHref(path, {}),
    readOnly: false,
    githubRepo: repo,
  };
  const health = healthOfIssues(issues);
  const attention = issues.filter((i) => i.severity === "critical" || i.severity === "high");
  const running = current && (current.status === "queued" || current.status === "running") ? current : null;
  const busy = running || batches.some((b) => b.status === "queued" || b.status === "running");
  const lastChecked = [finished?.finishedAt, ...batches.map((b) => b.finishedAt)].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  const names = new Map(flowRows.map((f) => [f.id, f.name]));

  // Flows whose last run had a problem first, then the rest in creation order.
  const problem = (id: string) => ["fail", "issue", "error"].includes(flowData.last.get(id)?.status ?? "");
  const shownFlows = [...flowRows].sort((a, b) => Number(problem(b.id)) - Number(problem(a.id))).slice(0, SHOWN);

  const activity = buildActivity({
    appId: app.id,
    scanRows,
    batchRows: batches,
    outcomes,
    flowsFound: (id) => flowRows.filter((f) => f.scanId === id).length,
    flowNames: names,
  }).slice(0, SHOWN);

  if (!current) {
    return (
      <div className="page">
        <PageHeader title={app.name} description={<Host url={app.url} />} />
        <Empty title="No scans yet">
          <p className="mb-4">Run the first scan and DappDrill will find this app&apos;s flows and try them with every wallet edge case.</p>
          <Button asChild>
            <Link href={`/new?app=${app.id}`}>Run the first scan</Link>
          </Button>
        </Empty>
      </div>
    );
  }

  const summary =
    health === "broken" ? `${plural(attention.length, "issue")} to fix` : health === "review" ? `Nothing broken, ${plural(issues.length, "issue")} to review` : "Nothing needs your attention";
  const host = hostFromUrl(app.url);
  const sameAsHost = host.toLowerCase() === app.name.toLowerCase();
  const shot = shotRow ? artifactUrl(artifactOwner(shotRow), shotRow.path) : null;

  return (
    <div className="page flex flex-col gap-8">
      {busy && <AutoRefresh every={5000} />}
      <section className="relative overflow-hidden rounded-xl border bg-muted/40">
        <div className="relative z-10 flex min-h-56 flex-col justify-between gap-6 p-6 sm:max-w-[52%] sm:p-8">
          <div className="flex flex-col gap-2">
            <h1 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tracking-tight">
              {app.name}
              <a href={app.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-normal tracking-normal text-muted-foreground hover:text-foreground">
                {!sameAsHost && host}
                <ExternalLink className="size-3.5" aria-label="Open the site" />
              </a>
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <HealthBadge health={health} />
              <span>
                {summary} · checked {timeAgo(lastChecked ?? current.createdAt)}
              </span>
            </div>
          </div>
          <div>
            <Button asChild variant="outline" size="sm" className="bg-background">
              <Link href={`${path}/scans/${finished?.id ?? current.id}`}>Latest report</Link>
            </Button>
          </div>
        </div>
        {shot && (
          // The dApp as we last saw it, quieted down: a grey miniature that bleeds off the card.
          <div className="pointer-events-none absolute top-8 -right-6 hidden w-[50%] sm:block" aria-hidden>
            <div className="overflow-hidden rounded-lg border bg-background shadow-xl">
              <div className="flex h-6 items-center gap-1.5 border-b px-2.5">
                <i className="size-2 rounded-full bg-border" />
                <i className="size-2 rounded-full bg-border" />
                <i className="size-2 rounded-full bg-border" />
                <span className="ml-2 truncate font-mono text-[10px] text-muted-foreground">{host}</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot} alt="" className="block w-full opacity-80 contrast-75 grayscale" />
            </div>
          </div>
        )}
      </section>

      {running && (
        <Link href={`${path}/scans/${running.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-live-bg bg-live-soft px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-live" />A scan is {running.status === "queued" ? "queued" : "running"}.
          </span>
          <span className="font-medium text-live-ink">Watch it live →</span>
        </Link>
      )}

      <div className="flex flex-col divide-y">
        <Section
          title="Open issues"
          count={issues.length}
          hint={fixed > 0 ? `Most severe first. ${fixed} fixed since the last scan.` : "Most severe first. Open one to see what happened and how to fix it."}
        >
          {issues.length === 0 ? (
            <PanelEmpty>No open issues. The latest scan and runs found nothing to fix.</PanelEmpty>
          ) : (
            <ItemList>
              {issues.map((i) => {
                const flow = (i.flowId && names.get(i.flowId)) || i.data.flowName;
                const edge = i.data.edgeCase && i.data.edgeCase !== "happy" ? edgeCaseInfo(i.data.edgeCase).label : null;
                return (
                  <ListItem key={i.id}>
                    <ItemMedia className="w-16 justify-start">
                      <SeverityTag severity={i.severity} />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full min-w-0">
                        <RowLink href={ctx.panelHref(`issue.${i.id}`)} className="line-clamp-2 sm:truncate">
                          {i.title}
                        </RowLink>
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions className="pointer-events-none">
                      <span className="hidden max-w-64 truncate text-xs text-muted-foreground md:block">{[flow, edge].filter(Boolean).join(" · ")}</span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </ListItem>
                );
              })}
            </ItemList>
          )}
        </Section>

        <Section
          title="Flows"
          count={flowRows.length}
          href={`${path}/flows`}
          hint={flowRows.length > SHOWN ? `Showing ${SHOWN} of ${flowRows.length}, the ones with problems first.` : "Saved tests DappDrill replays on every run."}
        >
          {flowRows.length === 0 ? <PanelEmpty>No saved flows yet. The scan saves the flows it finds.</PanelEmpty> : <FlowList appId={app.id} flows={shownFlows} data={flowData} />}
        </Section>

        <Section title="Recent activity" href={`${path}/runs`} hint="Scans and replays, newest first.">
          {activity.length === 0 ? (
            <PanelEmpty>Nothing has run yet.</PanelEmpty>
          ) : (
            <ItemList>
              {activity.map((a) => (
                <ActivityItem key={a.id} a={a} />
              ))}
            </ItemList>
          )}
        </Section>
      </div>
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}

const SHOWN = 6;

/**
 * A dashboard section: its heading in a narrow left column, the list on the
 * right. Stacks on small screens, with "View all" beside the title.
 */
function Section({ title, count, hint, href, children }: { title: string; count?: number; hint?: string; href?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 py-10 first:pt-2 last:pb-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 lg:flex-col lg:flex-nowrap lg:justify-start lg:gap-1.5">
        <h2 className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
          {title}
          {count !== undefined && <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {hint && <p className="order-last basis-full text-sm text-pretty text-muted-foreground lg:order-none lg:basis-auto">{hint}</p>}
        {href && (
          <Link href={href} className="group inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:mt-2">
            View all
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

function Host({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="font-mono text-sm hover:underline">
      {hostFromUrl(url)}
    </a>
  );
}
