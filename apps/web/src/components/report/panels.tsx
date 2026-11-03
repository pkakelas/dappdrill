import { describeStep, edgeCaseInfo, type FlowRun } from "@dappdrill/core";
import { db, flows, issues, runBatches, runs, signingReviews } from "@dappdrill/db";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { setIssueStatusAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { Cell, cx, RUN_STATUS_LABEL, SeverityTag, VerdictTag } from "@/components/ui";
import { artifactOwner, artifactUrl } from "@/lib/artifacts";
import { dateTime, timeAgo } from "@/lib/format";
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

/** What happened when the issue's flow was replayed again, for the panel. */
async function recheck(issue: IssueRow) {
  const edgeCase = issue.data.edgeCase;
  if (issue.status === "fixed" || issue.status === "ignored" || !issue.flowId || !edgeCase) return null;
  const [pending] = await db()
    .select({ id: runBatches.id })
    .from(runBatches)
    .where(
      and(
        eq(runBatches.appId, issue.appId),
        inArray(runBatches.status, ["queued", "running"]),
        sql`${runBatches.request}->'flowIds' @> ${JSON.stringify([issue.flowId])}::jsonb`,
      ),
    )
    .limit(1);
  if (pending) return { kind: "running" as const };
  const [later] = await db()
    .select({ id: runs.id, batchId: runs.batchId, status: runs.status, createdAt: runs.createdAt, filed: sql<number>`jsonb_array_length(${runs.result}->'issueIds')` })
    .from(runs)
    .where(
      and(
        eq(runs.flowId, issue.flowId),
        eq(runs.edgeCase, edgeCase),
        gt(runs.createdAt, issue.createdAt),
        issue.runId ? ne(runs.id, issue.runId) : undefined,
        isNull(sql`${runs.result}->>'variationId'`),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (!later) return null;
  const [again] = await db()
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.appId, issue.appId), eq(issues.fingerprint, issue.fingerprint), or(eq(issues.runId, later.id), sql`${issues.data}->>'runId' = ${later.id}`)))
    .limit(1);
  return { kind: "later" as const, hit: !!again, ...later };
}

function RecheckNote({ issue, ctx, check }: { issue: IssueRow; ctx: ViewCtx; check: Awaited<ReturnType<typeof recheck>> }) {
  const runLink = (id: string, label: string) => (
    <Link href={ctx.panelHref(`run.${id}`)} scroll={false} className="btn-link shrink-0">
      {label}
    </Link>
  );
  if (issue.status === "fixed") {
    return (
      <div className="card flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <span>Fixed. A later run of this flow didn't hit it ({timeAgo(issue.fixedAt)}).</span>
        {issue.fixedByRunId && runLink(issue.fixedByRunId, "Open that run")}
      </div>
    );
  }
  if (!check) return null;
  if (check.kind === "running") {
    return (
      <div className="card px-4 py-3 text-sm text-muted">
        <AutoRefresh every={4000} />
        Re-running this flow. This panel updates when it finishes.
      </div>
    );
  }
  const ago = timeAgo(check.createdAt);
  return (
    <div className="card flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span>
        {check.hit
          ? `Still happens. The replay ${ago} hit it again.`
          : issue.data.byModel && check.batchId
            ? "Replays don't run the check that found this. The next scan will confirm whether it's fixed."
            : check.status === "pass" || (check.status === "issue" && check.filed > 0)
            ? `The replay ${ago} didn't hit this. Re-run to confirm it's fixed.`
            : `The replay ${ago} couldn't tell whether this is fixed, so it stays open.`}
      </span>
      {runLink(check.id, "Open that run")}
    </div>
  );
}

export async function ResultPanel({ data, ctx }: { data: PanelData; ctx: ViewCtx }) {
  if (data.kind === "issue") return <IssuePanel issue={data.row} ctx={ctx} />;
  if (data.kind === "run") return <RunPanel run={data.row} ctx={ctx} />;
  return <ReviewPanel row={data.row} ctx={ctx} />;
}

async function IssuePanel({ issue, ctx }: { issue: IssueRow; ctx: ViewCtx }) {
  const d = issue.data;
  const owner = artifactOwner(issue);
  const [name, review, run, check] = await Promise.all([
    flowName(issue.flowId),
    reviewByCoreId(issue.appId, d.evidence.signingReviewId),
    issue.runId ? db().select().from(runs).where(eq(runs.id, issue.runId)).then((r) => r[0]) : Promise.resolve(undefined),
    recheck(issue),
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
          {d.unverified && <span className="pill bg-hair text-muted">Unverified</span>}
        </>
      }
      title={issue.title}
    >
      <RecheckNote issue={issue} ctx={ctx} check={check} />
      <p className="m-0 text-[15px] leading-relaxed text-ink-2">{d.summary}</p>
      <SaidVsAsked said={d.evidence.buttonLabel} asked={d.evidence.walletAsked} />
      {(d.expected || d.actual) && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {d.expected && (
            <>
              <dt className="text-muted">Expected</dt>
              <dd className="m-0">{d.expected}</dd>
            </>
          )}
          {d.actual && (
            <>
              <dt className="text-muted">Actual</dt>
              <dd className="m-0">{d.actual}</dd>
            </>
          )}
        </dl>
      )}
      {review && (
        <Link href={ctx.panelHref(`review.${review.id}`)} scroll={false} className="card flex items-center justify-between gap-3 px-4 py-3 no-underline hover:bg-sub">
          <span className="text-sm font-medium">Signing review: {review.data.title}</span>
          <VerdictTag verdict={review.verdict} />
        </Link>
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
      {!ctx.readOnly && (
        <div className="flex flex-wrap gap-2 border-t border-divide pt-5">
          {check?.kind !== "running" && (
            <RerunButton ctx={ctx} flowId={issue.flowId} edgeCase={d.edgeCase} label="Re-run" back={ctx.panelHref(`issue.${issue.id}`)} />
          )}
          {issue.status !== "fixed" && (
            <form action={setIssueStatusAction}>
              <input type="hidden" name="issueId" value={issue.id} />
              <input type="hidden" name="status" value={issue.status === "ignored" ? "open" : "ignored"} />
              <button type="submit" className="btn btn-sm">
                {issue.status === "ignored" ? "Reopen" : "This is expected"}
              </button>
            </form>
          )}
          {ctx.githubRepo ? (
            <a href={githubNewIssueUrl(ctx.githubRepo, issue.title, md)} target="_blank" rel="noreferrer" className="btn btn-sm">
              Open GitHub issue
            </a>
          ) : (
            <CopyButton text={md} label="Copy as Markdown" />
          )}
        </div>
      )}
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
    >
      <p className="m-0 text-sm text-ink-2">{edgeCaseInfo(run.edgeCase).description}</p>
      {r.reason && <p className={cx("m-0 rounded-lg px-4 py-3 text-sm", run.status === "fail" ? "bg-bad-soft text-bad-ink" : "bg-sub text-ink-2")}>{r.reason}</p>}

      {issueRows.length > 0 && (
        <PanelSection title="Issues in this run">
          <ul className="card m-0 list-none divide-y divide-divide p-0">
            {issueRows.map((i) => (
              <li key={i.id}>
                <Link href={ctx.panelHref(`issue.${i.id}`)} scroll={false} className="flex items-center gap-3 px-4 py-3 text-sm no-underline hover:bg-sub">
                  <SeverityTag severity={i.severity} />
                  <span className="min-w-0">{i.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}
      {reviewRows.length > 0 && (
        <PanelSection title="Signing requests">
          <ul className="card m-0 list-none divide-y divide-divide p-0">
            {reviewRows.map((v) => (
              <li key={v.id}>
                <Link href={ctx.panelHref(`review.${v.id}`)} scroll={false} className="flex items-center justify-between gap-3 px-4 py-3 text-sm no-underline hover:bg-sub">
                  <span className="min-w-0">{v.data.title}</span>
                  <VerdictTag verdict={v.verdict} />
                </Link>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {steps.length > 0 && (
        <PanelSection title="Steps">
          <ol className="card m-0 list-none divide-y divide-divide p-0">
            {steps.map((s, i) => {
              const res = results.get(i);
              return (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="w-5 shrink-0 text-right text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    {describeStep(s)}
                    {res?.error && <span className="mt-1 block text-[13px] text-bad">{res.error}</span>}
                  </span>
                  <span className={cx("shrink-0 text-[13px]", res?.status === "fail" ? "text-bad" : "text-muted")}>
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
      {!ctx.readOnly && (
        <div className="flex flex-wrap items-center gap-3 border-t border-divide pt-5">
          <RerunButton ctx={ctx} flowId={flowRow?.id} edgeCase={run.edgeCase} label="Re-run" />
          <span className="hint">{RUN_STATUS_LABEL[run.status]} · run {run.id}</span>
        </div>
      )}
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
