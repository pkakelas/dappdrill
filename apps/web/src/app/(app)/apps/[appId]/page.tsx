import { db, flows, runBatches } from "@dappdrill/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { makePanelHref } from "@/components/report/ctx";
import { CriticalIssueCard, IssueRowCard } from "@/components/report/issues";
import { ResultPanel } from "@/components/report/panels";
import { cx, Empty, HEALTH_TEXT, HealthBadge, RUN_STATUS_LABEL, RUN_STATUS_TEXT, Sparkbars } from "@/components/ui";
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
      <div className="page flex flex-col gap-6">
        <Header name={app.name} url={app.url} />
        <Empty title="No scans yet">
          <p className="m-0 mb-4">Run the first scan and DappDrill will find this app&apos;s flows and try them with every wallet edge case.</p>
          <Link href={`/new?app=${app.id}`} className="btn btn-primary">
            Run the first scan
          </Link>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page flex flex-col gap-9">
      {busy && <AutoRefresh every={5000} />}
      <div className="flex flex-col gap-4">
        <Header name={app.name} url={app.url} />
        <div className="flex flex-wrap items-center gap-3">
          <HealthBadge health={health} className="px-3 py-1.5 text-sm" />
          <p className={cx("m-0 text-[17px]", HEALTH_TEXT[health] === "text-muted" ? "text-ink-2" : HEALTH_TEXT[health])}>
            {health === "broken"
              ? `${plural(attention.length, "thing needs", "things need")} your attention.`
              : health === "review"
                ? `Nothing broken. ${plural(issues.length, "thing")} worth a look.`
                : "Nothing needs your attention."}
            <span className="text-muted"> Last checked {timeAgo(lastChecked ?? current.createdAt)}.</span>
          </p>
        </div>
      </div>

      {running && (
        <Link href={`${path}/scans/${running.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-live-bg bg-live-soft px-5 py-4 no-underline">
          <span className="flex items-center gap-2.5 text-sm">
            <span className="size-2 animate-pulse rounded-full bg-live" />
            Scan #{running.number} is {running.status === "queued" ? "queued" : "running"}.
          </span>
          <span className="text-sm font-medium text-live-ink">Watch it live →</span>
        </Link>
      )}

      <section aria-labelledby="open" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="open" className="h2">
            Open issues
          </h2>
          {fixed > 0 && <span className="text-sm text-muted">{plural(fixed, "issue")} fixed since the last scan</span>}
        </div>
        {issues.length === 0 ? (
          <p className="m-0 rounded-xl border border-line bg-card px-5 py-4 text-sm text-muted">None. The latest scan and runs found nothing to fix.</p>
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="latest" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="latest" className="h2">
              Latest scan
            </h2>
            <Link href={`/new?app=${app.id}`} className="btn-link">
              New scan
            </Link>
          </div>
          {finished ? (
            <Link href={`${path}/scans/${finished.id}`} className="card flex items-center justify-between gap-3 px-5 py-4 no-underline hover:bg-sub">
              <span className="flex flex-col">
                <span className="text-sm font-medium">Scan #{finished.number}</span>
                <span className="text-[13px] text-muted">
                  {timeAgo(finished.finishedAt ?? finished.createdAt)}
                  {finished.status === "stopped" ? " · stopped early" : ""}
                </span>
              </span>
              <span className="text-[13px] text-muted">Open report →</span>
            </Link>
          ) : (
            <p className="hint m-0">No finished scan yet.</p>
          )}

          <div className="mt-3 flex items-baseline justify-between">
            <h2 className="h2">Recent runs</h2>
            <Link href={`${path}/runs`} className="btn-link">
              All runs
            </Link>
          </div>
          {batches.length === 0 ? (
            <p className="hint m-0">No replays yet. Run your flows from the Flows tab.</p>
          ) : (
            <ul className="card m-0 list-none divide-y divide-divide p-0">
              {batches.map((b) => {
                const h = healthOfCounts(batchCounts.get(b.id));
                return (
                  <li key={b.id}>
                    <Link href={`${path}/runs/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 no-underline hover:bg-sub">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm">
                          {plural(b.request.flowIds.length, "flow")} · {TRIGGER_LABEL[b.trigger]}
                          {b.request.branch && <span className="font-mono text-[13px] text-muted"> {b.request.branch}</span>}
                        </span>
                        <span className="text-[13px] text-muted">{timeAgo(b.createdAt)}</span>
                      </span>
                      {b.status === "done" ? <HealthBadge health={h} /> : <span className="pill bg-live-bg text-live-ink capitalize">{b.status}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="flowhealth" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="flowhealth" className="h2">
              Flow health
            </h2>
            <Link href={`${path}/flows`} className="btn-link">
              All flows
            </Link>
          </div>
          {flowRows.length === 0 ? (
            <p className="hint m-0">No saved flows yet. The scan saves the flows it finds.</p>
          ) : (
            <ul className="card m-0 list-none divide-y divide-divide p-0">
              {flowRows.map((f) => {
                const st = statuses.get(f.id) ?? [];
                const last = st.at(-1);
                return (
                  <li key={f.id}>
                    <Link href={`${path}/flows/${f.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 no-underline hover:bg-sub">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{f.name}</span>
                        <span className={cx("text-[13px]", last ? RUN_STATUS_TEXT[last] : "text-muted")}>{last ? RUN_STATUS_LABEL[last] : "Not run yet"}</span>
                      </span>
                      <Sparkbars statuses={st} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}

function Header({ name, url }: { name: string; url: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="h1">{name}</h1>
      <a href={url} target="_blank" rel="noreferrer" className="w-fit font-mono text-sm text-muted no-underline hover:underline">
        {hostFromUrl(url)}
      </a>
    </div>
  );
}
