import { apiTokens, db, flows, runBatches } from "@dappdrill/db";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { makePanelHref } from "@/components/report/ctx";
import { CriticalIssueCard, IssueRowCard } from "@/components/report/issues";
import { ResultPanel } from "@/components/report/panels";
import { Blank, CheckIcon, cx, Empty, HEALTH_TEXT, HealthBadge, JobStatus, Notice, PageHeader, Reveal, Section } from "@/components/ui";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { githubRepo, healthOfCounts, issueCounts, latestScan, openIssues } from "@/lib/queries";
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

  const [current, finished, issues, batches, flowRows, [ci], repo, panelData] = await Promise.all([
    latestScan(app.id),
    latestScan(app.id, true),
    openIssues(app.id),
    db().select().from(runBatches).where(and(eq(runBatches.appId, app.id), isNull(runBatches.scanId))).orderBy(desc(runBatches.createdAt)).limit(5),
    db().select({ id: flows.id, name: flows.name }).from(flows).where(and(eq(flows.appId, app.id), eq(flows.archived, false))),
    db().select({ n: count() }).from(apiTokens).where(and(eq(apiTokens.appId, app.id), isNotNull(apiTokens.lastUsedAt))),
    githubRepo(app.teamId),
    loadPanel(app.id, panel),
  ]);
  const batchCounts = await issueCounts("batch", batches.slice(0, 1).map((b) => b.id));
  const ctx = { appId: app.id, panelHref: makePanelHref(path, {}), readOnly: false, githubRepo: repo };
  const health = healthOfIssues(issues);
  const attention = issues.filter((i) => i.severity === "critical" || i.severity === "high");
  const rest = issues.filter((i) => i.severity !== "critical" && i.severity !== "high");
  const running = current && (current.status === "queued" || current.status === "running") ? current : null;
  const busy = running || batches.some((b) => b.status === "queued" || b.status === "running");
  const lastChecked = [finished?.finishedAt, ...batches.map((b) => b.finishedAt)].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  const names = new Map(flowRows.map((f) => [f.id, f.name]));
  const lastBatch = batches[0];
  const onPullRequests = (ci?.n ?? 0) > 0;
  const checklist = [
    { done: Boolean(finished), label: "Scan the app", hint: "The agent finds the flows and tries each one with wallet edge cases.", href: running ? `${path}/scans/${running.id}` : undefined },
    { done: batches.length > 0, label: "Replay your saved flows", hint: "Check the steps look right, then run them. Replays are unlimited.", href: `${path}/flows` },
    { done: Boolean(app.scheduleTime) || onPullRequests, label: "Keep it checked", hint: "Run the flows every day, or on every pull request.", href: `${path}/settings#schedule-section` },
  ];
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
            <Link href={`${path}/settings`} className="btn btn-primary">
              Check settings and scan
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

      {checklist.some((c) => !c.done) && (
        <Section title="Getting started">
          <ol className="list">
            {checklist.map((c, i) => (
              <li key={c.label}>
                <Link href={c.href ?? path} className={cx("row no-underline transition-colors hover:bg-sub", c.done && "text-muted")}>
                  <span className="flex min-w-0 flex-[1_1_240px] items-start gap-3">
                    <span
                      className={cx(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-2xs",
                        c.done ? "border-ink bg-ink text-paper" : "border-line-strong text-muted",
                      )}
                      aria-hidden
                    >
                      {c.done ? <CheckIcon /> : i + 1}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-body font-medium">{c.label}</span>
                      {!c.done && <span className="meta">{c.hint}</span>}
                    </span>
                  </span>
                  <span className="sr-only">{c.done ? "Done" : "To do"}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>
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

      <Section title="How it's checked">
        <div className="card grid grid-cols-2 gap-px overflow-hidden bg-divide sm:grid-cols-4">
          <Fact href={`${path}/flows`} label="Flows">
            {plural(flowRows.length, "saved flow")}
          </Fact>
          <Fact href={lastBatch ? `${path}/runs/${lastBatch.id}` : `${path}/runs`} label="Last replay">
            {lastBatch ? (
              <JobStatus status={lastBatch.status} health={healthOfCounts(batchCounts.get(lastBatch.id))}>
                {timeAgo(lastBatch.createdAt)}
              </JobStatus>
            ) : (
              <span className="text-muted">Not yet</span>
            )}
          </Fact>
          <Fact href={`${path}/settings#schedule-section`} label="Schedule">
            {app.scheduleTime ? `Daily, ${app.scheduleTime} UTC` : <span className="text-muted">Off</span>}
          </Fact>
          <Fact href={`${path}/settings#ci-section`} label="Pull requests">
            {onPullRequests ? "On" : <span className="text-muted">Off</span>}
          </Fact>
        </div>
      </Section>

      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}

function Fact({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex flex-col gap-1.5 bg-card px-4 py-3.5 no-underline transition-colors hover:bg-sub">
      <span className="label">{label}</span>
      <span className="text-body">{children}</span>
    </Link>
  );
}
