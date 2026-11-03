import { db, flows, runBatches } from "@dappdrill/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { makePanelHref } from "@/components/report/ctx";
import { CriticalIssueCard, IssueRowCard } from "@/components/report/issues";
import { ResultPanel } from "@/components/report/panels";
import { cx, Empty, HealthBadge, PageHeader, RUN_STATUS_LABEL, RUN_STATUS_TEXT, Sparkbars } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hostFromUrl, plural, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { fixedSince, githubRepo, healthOfCounts, issueCounts, latestScan, openIssues, recentStatuses } from "@/lib/queries";
import { loadPanel } from "@/lib/report";
import { healthOfIssues } from "@dappdrill/core";
import { requireApp } from "@/lib/session";

type Props = { params: Promise<{ appId: string }>; searchParams: Promise<{ panel?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

export default async function OverviewPage({ params, searchParams }: Props) {
  const { appId } = await params;
  const { panel } = await searchParams;
  const { app } = await requireApp(appId);
  const path = `/apps/${app.id}`;

  const [current, finished, issues, batches, flowRows, repo, panelData] = await Promise.all([
    latestScan(app.id),
    latestScan(app.id, true),
    openIssues(app.id),
    db().select().from(runBatches).where(and(eq(runBatches.appId, app.id), isNull(runBatches.scanId))).orderBy(desc(runBatches.createdAt)).limit(5),
    db().select().from(flows).where(and(eq(flows.appId, app.id), eq(flows.archived, false))).orderBy(asc(flows.createdAt)),
    githubRepo(app.teamId),
    loadPanel(app.id, panel),
  ]);
  const [batchCounts, statuses, fixed] = await Promise.all([
    issueCounts("batch", batches.map((b) => b.id)),
    recentStatuses(flowRows.map((f) => f.id)),
    fixedSince(app.id, finished?.createdAt),
  ]);
  const ctx = { appId: app.id, panelHref: makePanelHref(path, {}), readOnly: false, githubRepo: repo };
  const health = healthOfIssues(issues);
  const attention = issues.filter((i) => i.severity === "critical" || i.severity === "high");
  const running = current && (current.status === "queued" || current.status === "running") ? current : null;
  const busy = running || batches.some((b) => b.status === "queued" || b.status === "running");
  const lastChecked = [finished?.finishedAt, ...batches.map((b) => b.finishedAt)].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  const names = new Map(flowRows.map((f) => [f.id, f.name]));

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
    health === "broken"
      ? `${plural(attention.length, "thing needs", "things need")} your attention.`
      : health === "review"
        ? `Nothing broken. ${plural(issues.length, "thing")} worth a look.`
        : "Nothing needs your attention.";

  return (
    <div className="page flex flex-col gap-6">
      {busy && <AutoRefresh every={5000} />}
      <PageHeader
        title={app.name}
        description={<Host url={app.url} />}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`${path}/scans/${finished?.id ?? current.id}`}>Latest report</Link>
          </Button>
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <HealthBadge health={health} />
          <span>{summary}</span>
          <span className="text-muted-foreground">Last checked {timeAgo(lastChecked ?? current.createdAt)}.</span>
        </div>
      </PageHeader>

      {running && (
        <Link href={`${path}/scans/${running.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-live-bg bg-live-soft px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-live" />
            Scan #{running.number} is {running.status === "queued" ? "queued" : "running"}.
          </span>
          <span className="font-medium text-live-ink">Watch it live →</span>
        </Link>
      )}

      <section aria-labelledby="open" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="open" className="text-lg font-semibold">
            Open issues
          </h2>
          {fixed > 0 && <span className="text-muted-foreground">{plural(fixed, "issue")} fixed since the last scan</span>}
        </div>
        {issues.length === 0 ? (
          <Empty title="No open issues">The latest scan and runs found nothing to fix.</Empty>
        ) : (
          issues.map((i) =>
            i.severity === "critical" ? (
              <CriticalIssueCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
            ) : (
              <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
            ),
          )
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>Flows</CardTitle>
            <CardAction>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href={`${path}/flows`}>All flows</Link>
              </Button>
            </CardAction>
          </CardHeader>
          {flowRows.length === 0 ? (
            <CardContent className="pb-6 text-muted-foreground">No saved flows yet. The scan saves the flows it finds.</CardContent>
          ) : (
            <ul className="divide-y border-t">
              {flowRows.map((f) => {
                const st = statuses.get(f.id) ?? [];
                const last = st.at(-1);
                return (
                  <li key={f.id}>
                    <Link href={`${path}/flows/${f.id}`} className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-muted/50">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{f.name}</span>
                        <span className={cx("text-xs", last ? RUN_STATUS_TEXT[last] : "text-muted-foreground")}>{last ? RUN_STATUS_LABEL[last] : "Not run yet"}</span>
                      </span>
                      <Sparkbars statuses={st} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>Recent runs</CardTitle>
            <CardAction>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href={`${path}/runs`}>All runs</Link>
              </Button>
            </CardAction>
          </CardHeader>
          {batches.length === 0 ? (
            <CardContent className="pb-6 text-muted-foreground">No replays yet. Run your flows from the Flows tab.</CardContent>
          ) : (
            <ul className="divide-y border-t">
              {batches.map((b) => {
                const h = healthOfCounts(batchCounts.get(b.id));
                return (
                  <li key={b.id}>
                    <Link href={`${path}/runs/${b.id}`} className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-muted/50">
                      <span className="flex min-w-0 flex-col">
                        <span>
                          {plural(b.request.flowIds.length, "flow")} · {TRIGGER_LABEL[b.trigger]}
                          {b.request.branch && <span className="font-mono text-xs text-muted-foreground"> {b.request.branch}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">{timeAgo(b.createdAt)}</span>
                      </span>
                      {b.status === "done" ? (
                        <HealthBadge health={h} />
                      ) : (
                        <Badge variant="secondary" className="bg-live-bg text-live-ink capitalize">
                          {b.status}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}

function Host({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="font-mono text-sm hover:underline">
      {hostFromUrl(url)}
    </a>
  );
}
