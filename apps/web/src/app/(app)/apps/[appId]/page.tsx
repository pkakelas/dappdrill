import { db, flows, runBatches } from "@dappdrill/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { makePanelHref } from "@/components/report/ctx";
import { CriticalIssueCard, IssueRowCard } from "@/components/report/issues";
import { ResultPanel } from "@/components/report/panels";
import { Blank, cx, Empty, HEALTH_TEXT, HealthBadge, JobStatus, List, ListRow, Mono, Notice, PageHeader, Reveal, RunState, Section, Sparkbars } from "@/components/ui";
import { hostFromUrl, plural, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { githubRepo, healthOfCounts, issueCounts, latestScan, openIssues, recentStatuses } from "@/lib/queries";
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
  const [batchCounts, statuses] = await Promise.all([issueCounts("batch", batches.map((b) => b.id)), recentStatuses(flowRows.map((f) => f.id))]);
  const ctx = { appId: app.id, panelHref: makePanelHref(path, {}), readOnly: false, githubRepo: repo };
  const health = healthOfIssues(issues);
  const attention = issues.filter((i) => i.severity === "critical" || i.severity === "high");
  const rest = issues.filter((i) => i.severity !== "critical" && i.severity !== "high");
  const running = current && (current.status === "queued" || current.status === "running") ? current : null;
  const busy = running || batches.some((b) => b.status === "queued" || b.status === "running");
  const lastChecked = [finished?.finishedAt, ...batches.map((b) => b.finishedAt)].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  const names = new Map(flowRows.map((f) => [f.id, f.name]));
  const host = (
    <a href={app.url} target="_blank" rel="noreferrer" className="font-mono text-sm text-muted no-underline hover:underline">
      {hostFromUrl(app.url)}
    </a>
  );

  if (!current) {
    return (
      <div className="page">
        <PageHeader title={app.name} sub={host} />
        <Empty
          title="No scans yet"
          action={
            <Link href={`/new?app=${app.id}`} className="btn btn-primary">
              Run the first scan
            </Link>
          }
        >
          Run the first scan and DappDrill will find this app&apos;s flows and try them with every wallet edge case.
        </Empty>
      </div>
    );
  }

  const issueCard = (i: (typeof issues)[number]) => {
    const flowName = i.flowId ? names.get(i.flowId) : undefined;
    return i.severity === "critical" ? <CriticalIssueCard key={i.id} issue={i} ctx={ctx} flowName={flowName} /> : <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={flowName} />;
  };

  return (
    <div className="page">
      {busy && <AutoRefresh every={5000} />}
      <PageHeader
        title={app.name}
        sub={host}
        status={
          <div className="flex flex-wrap items-center gap-3">
            <HealthBadge health={health} large />
            <p className={cx("lead", health !== "ok" && HEALTH_TEXT[health])}>
              {health === "broken"
                ? `${plural(attention.length, "thing needs", "things need")} your attention.`
                : health === "review"
                  ? `Nothing broken. ${plural(issues.length, "thing")} worth a look.`
                  : "Nothing needs your attention."}
              <span className="text-muted"> Last checked {timeAgo(lastChecked ?? current.createdAt)}.</span>
            </p>
          </div>
        }
      />

      {running && (
        <Notice
          tone="live"
          role="status"
          title={`Scan #${running.number} is ${running.status === "queued" ? "queued" : "running"}`}
          action={
            <Link href={`${path}/scans/${running.id}`} className="btn btn-sm">
              Watch it live
            </Link>
          }
        >
          The agent is exploring the app. New flows and issues show up here when it finishes.
        </Notice>
      )}

      <Section title="Open issues" hint={issues.length > 0 ? "From the latest scan and the runs since. Open one for the evidence." : undefined}>
        {issues.length === 0 ? (
          <Blank>None. The latest scan and runs found nothing to fix.</Blank>
        ) : attention.length > 0 && rest.length > 0 ? (
          <>
            {attention.map(issueCard)}
            <Reveal label={`Show ${plural(rest.length, "lower-severity issue")}`}>{rest.map(issueCard)}</Reveal>
          </>
        ) : (
          issues.map(issueCard)
        )}
      </Section>

      <div className="grid grid-cols-1 gap-x-8 gap-y-9 lg:grid-cols-2">
        <div className="flex flex-col gap-9">
          <Section
            title="Latest scan"
            action={
              <Link href={`/new?app=${app.id}`} className="btn-link">
                New scan
              </Link>
            }
          >
            {finished ? (
              <List>
                <ListRow
                  href={`${path}/scans/${finished.id}`}
                  title={`Scan #${finished.number}`}
                  meta={`${timeAgo(finished.finishedAt ?? finished.createdAt)}${finished.status === "stopped" ? " · stopped early" : ""}`}
                  aside={<span className="meta">Open report →</span>}
                />
              </List>
            ) : (
              <Blank>No finished scan yet.</Blank>
            )}
          </Section>

          <Section
            title="Recent runs"
            action={
              <Link href={`${path}/runs`} className="btn-link">
                All runs
              </Link>
            }
          >
            {batches.length === 0 ? (
              <Blank>No replays yet. Run your flows from the Flows tab.</Blank>
            ) : (
              <List>
                {batches.map((b) => (
                  <ListRow
                    key={b.id}
                    href={`${path}/runs/${b.id}`}
                    title={
                      <>
                        {plural(b.request.flowIds.length, "flow")} · {TRIGGER_LABEL[b.trigger]}
                        {b.request.branch && <Mono className="text-meta text-muted"> {b.request.branch}</Mono>}
                      </>
                    }
                    meta={timeAgo(b.createdAt)}
                    aside={<JobStatus status={b.status} health={healthOfCounts(batchCounts.get(b.id))} />}
                  />
                ))}
              </List>
            )}
          </Section>
        </div>

        <Section
          title="Flow health"
          action={
            <Link href={`${path}/flows`} className="btn-link">
              All flows
            </Link>
          }
        >
          {flowRows.length === 0 ? (
            <Blank>No saved flows yet. The scan saves the flows it finds.</Blank>
          ) : (
            <List>
              {flowRows.map((f) => {
                const st = statuses.get(f.id) ?? [];
                return <ListRow key={f.id} href={`${path}/flows/${f.id}`} title={<span className="block truncate">{f.name}</span>} meta={<RunState status={st.at(-1)} />} aside={<Sparkbars statuses={st} />} />;
              })}
            </List>
          )}
        </Section>
      </div>
      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
