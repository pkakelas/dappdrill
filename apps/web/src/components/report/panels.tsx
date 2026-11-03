import { describeStep, edgeCaseInfo, type FlowRun } from "@dappdrill/core";
import { db, flows, issues, runs, signingReviews } from "@dappdrill/db";
import { and, asc, eq, or, sql } from "drizzle-orm";
import Link from "next/link";
import { setIssueStatusAction } from "@/actions/results";
import { ActionButton, Cell, cx, Facts, List, ListRow, Notice, Pill, RUN_STATUS_LABEL, SeverityTag, VerdictTag } from "@/components/ui";
import { artifactOwner, artifactUrl } from "@/lib/artifacts";
import { dateTime } from "@/lib/format";
import { githubNewIssueUrl, issueMarkdown } from "@/lib/github";
import type { IssueRow, RunRow } from "@/lib/queries";
import { cellKind, type PanelData, type ReviewRow } from "@/lib/report";
import type { ViewCtx } from "./ctx";
import { CopyButton } from "./copy-button";
import { ConsoleLog, RpcLog, Screenshot, Video } from "./evidence";
import { issueMeta, RerunButton, SaidVsAsked } from "./issues";
import { PanelSection, SidePanel } from "./side-panel";
import { SigningReviewView } from "./signing-review";

async function flowName(flowId?: string | null): Promise<string | undefined> {
  if (!flowId) return undefined;
  const [f] = await db().select({ name: flows.name }).from(flows).where(eq(flows.id, flowId));
  return f?.name;
}

async function reviewByCoreId(appId: string, id?: string): Promise<ReviewRow | undefined> {
  if (!id) return undefined;
  const [row] = await db()
    .select()
    .from(signingReviews)
    .where(and(eq(signingReviews.appId, appId), or(eq(signingReviews.id, id), sql`${signingReviews.data}->>'id' = ${id}`)))
    .limit(1);
  return row;
}

export async function ResultPanel({ data, ctx }: { data: PanelData; ctx: ViewCtx }) {
  if (data.kind === "issue") return <IssuePanel issue={data.row} ctx={ctx} />;
  if (data.kind === "run") return <RunPanel run={data.row} ctx={ctx} />;
  return <ReviewPanel row={data.row} ctx={ctx} />;
}

async function IssuePanel({ issue, ctx }: { issue: IssueRow; ctx: ViewCtx }) {
  const d = issue.data;
  const owner = artifactOwner(issue);
  const [name, review, run] = await Promise.all([
    flowName(issue.flowId),
    reviewByCoreId(issue.appId, d.evidence.signingReviewId),
    issue.runId ? db().select().from(runs).where(eq(runs.id, issue.runId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const result: FlowRun | undefined = run?.result;
  const video = artifactUrl(owner, d.evidence.video ?? result?.video, ctx.share);
  const shot = artifactUrl(owner, d.evidence.screenshot ?? result?.finalScreenshot, ctx.share);
  const md = issueMarkdown(d);

  return (
    <SidePanel
      closeHref={ctx.panelHref(null)}
      eyebrow={
        <>
          <SeverityTag severity={issue.severity} />
          <span>{issueMeta(issue, name)}</span>
          {d.unverified && <Pill>Unverified</Pill>}
          {issue.status === "ignored" && <Pill>Marked expected</Pill>}
        </>
      }
      title={issue.title}
      footer={
        !ctx.readOnly && (
          <>
            <RerunButton ctx={ctx} flowId={issue.flowId} edgeCase={d.edgeCase} label="Re-run" />
            <ActionButton action={setIssueStatusAction} fields={{ issueId: issue.id, status: issue.status === "ignored" ? "open" : "ignored" }} className="btn-sm">
              {issue.status === "ignored" ? "Reopen" : "This is expected"}
            </ActionButton>
            {ctx.githubRepo ? (
              <a href={githubNewIssueUrl(ctx.githubRepo, issue.title, md)} target="_blank" rel="noreferrer" className="btn btn-sm">
                Open GitHub issue
              </a>
            ) : (
              <CopyButton text={md} label="Copy as Markdown" />
            )}
          </>
        )
      }
    >
      <p className="m-0 text-body text-ink-2">{d.summary}</p>
      <SaidVsAsked said={d.evidence.buttonLabel} asked={d.evidence.walletAsked} />
      {(d.expected || d.actual) && (
        <Facts
          items={[
            ...(d.expected ? [["Expected", d.expected] as [string, string]] : []),
            ...(d.actual ? [["Actual", d.actual] as [string, string]] : []),
          ]}
        />
      )}
      {review && (
        <List>
          <ListRow href={ctx.panelHref(`review.${review.id}`)} scroll={false} title={`Signing review: ${review.data.title}`} aside={<VerdictTag verdict={review.verdict} />} />
        </List>
      )}
      {d.stepsToReproduce.length > 0 && (
        <PanelSection title="Steps to reproduce">
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-normal">
            {d.stepsToReproduce.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </PanelSection>
      )}
      <Video src={video} />
      <Screenshot src={shot} alt={`Screenshot: ${issue.title}`} />
      <ConsoleLog entries={d.evidence.console ?? result?.console} />
      <RpcLog entries={d.evidence.rpc ?? result?.rpc} />
    </SidePanel>
  );
}

async function RunPanel({ run, ctx }: { run: RunRow; ctx: ViewCtx }) {
  const r = run.result;
  const owner = artifactOwner(run);
  const flowId = run.flowId ?? r.flowId;
  const [flowRow] = await db().select().from(flows).where(eq(flows.id, flowId));
  const [issueRows, reviewRows] = await Promise.all([
    db().select().from(issues).where(and(eq(issues.appId, run.appId), or(eq(issues.runId, run.id), sql`${issues.data}->>'runId' = ${run.id}`))),
    db()
      .select()
      .from(signingReviews)
      .where(and(eq(signingReviews.appId, run.appId), sql`${signingReviews.data}->>'runId' = ${run.id}`))
      .orderBy(asc(signingReviews.createdAt)),
  ]);
  const steps = flowRow?.definition.steps ?? [];
  const results = new Map(r.steps.map((s) => [s.index, s]));
  const kind = cellKind(run, { issues: issueRows, reviews: reviewRows });

  return (
    <SidePanel
      closeHref={ctx.panelHref(null)}
      eyebrow={
        <>
          <Cell kind={kind} />
          <span>
            {edgeCaseInfo(run.edgeCase).label} · {r.mode === "live" ? "live" : "fork"} · {dateTime(run.createdAt)}
          </span>
        </>
      }
      title={flowRow?.name ?? "Deleted flow"}
      footer={
        !ctx.readOnly && (
          <>
            <RerunButton ctx={ctx} flowId={flowRow?.id} edgeCase={run.edgeCase} label="Re-run" />
            <span className="meta ml-auto">
              {RUN_STATUS_LABEL[run.status]} · run <span className="font-mono">{run.id.slice(0, 8)}</span>
            </span>
          </>
        )
      }
    >
      <p className="m-0 text-sm text-ink-2">{edgeCaseInfo(run.edgeCase).description}</p>
      {r.reason && <Notice tone={run.status === "fail" ? "bad" : run.status === "issue" ? "warn" : "neutral"}>{r.reason}</Notice>}

      {issueRows.length > 0 && (
        <PanelSection title="Issues in this run">
          <List>
            {issueRows.map((i) => (
              <ListRow key={i.id} href={ctx.panelHref(`issue.${i.id}`)} scroll={false} title={i.title} aside={<SeverityTag severity={i.severity} />} />
            ))}
          </List>
        </PanelSection>
      )}
      {reviewRows.length > 0 && (
        <PanelSection title="Signing requests">
          <List>
            {reviewRows.map((v) => (
              <ListRow key={v.id} href={ctx.panelHref(`review.${v.id}`)} scroll={false} title={v.data.title} aside={<VerdictTag verdict={v.verdict} />} />
            ))}
          </List>
        </PanelSection>
      )}

      {steps.length > 0 && (
        <PanelSection title="Steps">
          <ol className="list">
            {steps.map((s, i) => {
              const res = results.get(i);
              return (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="w-5 shrink-0 text-right font-mono text-meta text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    {describeStep(s)}
                    {res?.error && <span className="mt-1 block text-meta text-bad">{res.error}</span>}
                  </span>
                  <span className={cx("shrink-0 text-meta tabular-nums", res?.status === "fail" ? "text-bad" : "text-muted")}>
                    {res ? (res.status === "pass" ? `${(res.durationMs / 1000).toFixed(1)} s` : res.status === "fail" ? "Failed" : "Skipped") : "—"}
                  </span>
                </li>
              );
            })}
          </ol>
        </PanelSection>
      )}

      <Video src={artifactUrl(owner, r.video, ctx.share)} />
      <Screenshot src={artifactUrl(owner, r.finalScreenshot, ctx.share)} alt="Final screen" title="Final screen" />
      <ConsoleLog entries={r.console} />
      <RpcLog entries={r.rpc} />
    </SidePanel>
  );
}

async function ReviewPanel({ row, ctx }: { row: ReviewRow; ctx: ViewCtx }) {
  const runId = row.data.runId;
  const siblings = runId
    ? await db()
        .select()
        .from(signingReviews)
        .where(and(eq(signingReviews.appId, row.appId), sql`${signingReviews.data}->>'runId' = ${runId}`))
        .orderBy(asc(signingReviews.createdAt))
    : [];
  return (
    <SidePanel
      closeHref={ctx.panelHref(null)}
      eyebrow={
        <>
          <span>Signing review</span>
          {!ctx.readOnly && (
            <Link href={`/apps/${ctx.appId}/signing/${row.id}`} className="btn-link">
              Open full page
            </Link>
          )}
        </>
      }
      title={row.data.title}
    >
      <SigningReviewView row={row} ctx={ctx} siblings={siblings} compact />
    </SidePanel>
  );
}
