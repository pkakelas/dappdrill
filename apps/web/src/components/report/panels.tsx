import { applyParams, CATEGORY_LABEL, describeStep, edgeCaseInfo, paramValues, type Flow, type FlowRun } from "@dappdrill/core";
import { db, flows, issues, runBatches, runs, signingReviews } from "@dappdrill/db";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { setIssueStatusAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { Cell, cx, RUN_STATUS_LABEL, SeverityTag, VerdictTag } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { artifactOwner, artifactUrl } from "@/lib/artifacts";
import { dateTime, timeAgo } from "@/lib/format";
import { githubNewIssueUrl, issueMarkdown } from "@/lib/github";
import type { IssueRow, RunRow } from "@/lib/queries";
import { cellKind, type PanelData, type ReviewRow } from "@/lib/report";
import type { ViewCtx } from "./ctx";
import { CopyButton } from "./copy-button";
import { ConsoleLog, RpcLog, Screenshot, Video } from "./evidence";
import { Compare, RerunButton, SaidVsAsked, StatusBadge, type Side } from "./issues";
import { PanelSection, SidePanel } from "./side-panel";
import { SigningReviewView } from "./signing-review";

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
    <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0">
      <Link href={ctx.panelHref(`run.${id}`)} scroll={false}>
        {label}
      </Link>
    </Button>
  );
  if (issue.status === "fixed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-3">
        <span>Fixed. A later run of this flow didn't hit it ({timeAgo(issue.fixedAt)}).</span>
        {issue.fixedByRunId && runLink(issue.fixedByRunId, "Open that run")}
      </div>
    );
  }
  if (!check) return null;
  if (check.kind === "running") {
    return (
      <div className="rounded-lg border border-live-bg bg-live-soft px-4 py-3 text-live-ink">
        <AutoRefresh every={4000} />
        Re-running this flow. This panel updates when it finishes.
      </div>
    );
  }
  const ago = timeAgo(check.createdAt);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-3">
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

/** "approve(0x…, 2^256-1)" reads as a call, so it gets mono. */
const CALL = /^[a-zA-Z_]\w*\(.*\)$/s;

/** Where the issue was found, one fact per row. */
function Facts({ issue, flowName, ctx }: { issue: IssueRow; flowName?: string; ctx: ViewCtx }) {
  const d = issue.data;
  const edge = d.edgeCase ? edgeCaseInfo(d.edgeCase) : undefined;
  const flow = flowName ?? d.flowName;
  const rows: [string, ReactNode][] = [];
  if (flow)
    rows.push([
      "Flow",
      issue.flowId && !ctx.readOnly ? (
        <Link href={`/apps/${ctx.appId}/flows/${issue.flowId}`} className="underline-offset-4 hover:underline">
          {flow}
        </Link>
      ) : (
        flow
      ),
    ]);
  if (edge) rows.push(["Wallet case", edge.id === "happy" ? edge.label : <>{edge.label} <span className="text-muted-foreground">· {edge.description}</span></>]);
  rows.push(["Kind", CATEGORY_LABEL[issue.category]]);
  rows.push([
    "Found",
    <>
      {timeAgo(issue.createdAt)} <span className="text-muted-foreground">· {issue.batchId ? "in a replay" : "in a scan"}</span>
      {issue.runId && (
        <>
          {" "}
          <span className="text-muted-foreground">·</span>{" "}
          <Link href={ctx.panelHref(`run.${issue.runId}`)} scroll={false} className="underline-offset-4 hover:underline">
            Open the run
          </Link>
        </>
      )}
    </>,
  ]);
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The summary, then the facts behind it: what the user saw against what the wallet was asked, and what should have happened against what did. */
function WhatHappened({ issue, review, ctx }: { issue: IssueRow; review?: ReviewRow; ctx: ViewCtx }) {
  const d = issue.data;
  const said = d.evidence.buttonLabel;
  const asked = d.evidence.walletAsked;
  // Playwright errors carry a call log; the first line says what failed, the rest is for whoever debugs it.
  const [actual, ...log] = (d.actual ?? "").split("\n");
  // Red goes on whichever side is the problem: the request itself for signing issues, otherwise what the page did.
  const badRequest = issue.category === "signing";
  const outcome: Side[] = [];
  if (d.expected) outcome.push({ label: "Expected", children: d.expected });
  if (actual && actual !== asked) outcome.push({ label: "Actual", children: <span className={cx(CALL.test(actual) && "font-mono text-xs break-all")}>{actual}</span>, bad: !badRequest || !asked });
  const details = log.some((l) => l.trim()) && (
    <details className="group border-t">
      <summary className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50">
        Error details
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <pre className="max-h-60 overflow-auto border-t bg-muted/40 px-4 py-3 font-mono text-xs whitespace-pre-wrap">{log.join("\n").trim()}</pre>
    </details>
  );
  return (
    <PanelSection title="What happened">
      {/* Older issues embed the Playwright call log in the summary; the Actual row keeps it. */}
      <p className="leading-relaxed">{d.summary.split("\nCall log:")[0]}</p>
      <div className="mt-1 flex flex-col gap-3">
        {(said || asked) && <SaidVsAsked said={said} asked={asked} bad={badRequest} />}
        {outcome.length > 0 && <Compare sides={outcome} footer={details} />}
        {review && (
          <Link href={ctx.panelHref(`review.${review.id}`)} scroll={false} className="flex items-center gap-3 rounded-lg border px-4 py-3 hover:bg-muted/50">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-muted-foreground">Signing review</span>
              <span className="flex min-w-0 items-center gap-2">
                <VerdictTag verdict={review.verdict} />
                {review.data.title !== asked && <span className="truncate">{review.data.title}</span>}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}
      </div>
    </PanelSection>
  );
}

/** The flow's steps as written, with the one where it went wrong marked. Older issues only kept the text. */
function Repro({ issue, flow, result, at }: { issue: IssueRow; flow?: Flow; result?: FlowRun; at?: number }) {
  const lines = issue.data.stepsToReproduce;
  const numbered = /^\d+\.\s*/;
  // The engine writes "1. Connect", plus unnumbered setup lines such as the starting chain.
  const setup = lines.some((l) => numbered.test(l)) ? lines.filter((l) => !numbered.test(l)) : [];
  const values = flow ? paramValues(flow) : {};
  const items = flow?.steps.length ? flow.steps.map((s) => applyParams(describeStep(s), values)) : lines.filter((l) => numbered.test(l)).map((l) => l.replace(numbered, ""));
  if (!items.length) return null;
  const results = new Map(result?.steps.map((s) => [s.index, s]));
  const failed = result?.steps.find((s) => s.status === "fail")?.index;
  const mark = at ?? failed;
  return (
    <PanelSection title="Steps to reproduce">
      {setup.length > 0 && (
        <p>
          <span className="text-muted-foreground">Before you start: </span>
          {setup.join(" ")}
        </p>
      )}
      <ol className="flex flex-col">
        {items.map((s, i) => {
          const here = i === mark;
          const skipped = results.get(i)?.status === "skipped" || (mark !== undefined && failed === mark && i > mark);
          return (
            <li key={i} className={cx("flex items-baseline gap-3 rounded-md px-3 py-1.5", here && "bg-bad-soft text-bad-ink", skipped && "text-muted-foreground")}>
              <span className={cx("w-4 shrink-0 text-right text-xs tabular-nums", !here && "text-muted-foreground")}>{i + 1}</span>
              <span className="min-w-0 flex-1 break-words">{s}</span>
              {here && <span className="shrink-0 text-xs">{issue.category === "signing" ? "Signing request" : "Goes wrong here"}</span>}
            </li>
          );
        })}
      </ol>
    </PanelSection>
  );
}

async function IssuePanel({ issue, ctx }: { issue: IssueRow; ctx: ViewCtx }) {
  const d = issue.data;
  const owner = artifactOwner(issue);
  const [flowRow, review, run, check] = await Promise.all([
    issue.flowId ? db().select().from(flows).where(eq(flows.id, issue.flowId)).then((r) => r[0]) : Promise.resolve(undefined),
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
          {d.unverified && <Badge variant="secondary">Unverified</Badge>}
          <StatusBadge status={issue.status} />
        </>
      }
      title={issue.title}
    >
      <Facts issue={issue} flowName={flowRow?.name} ctx={ctx} />
      {!ctx.readOnly && (
        <div className="flex flex-wrap gap-2">
          {check?.kind !== "running" && (
            <RerunButton ctx={ctx} flowId={issue.flowId} edgeCase={d.edgeCase} label="Re-run" back={ctx.panelHref(`issue.${issue.id}`)} />
          )}
          {issue.status !== "fixed" && (
            <form action={setIssueStatusAction}>
              <input type="hidden" name="issueId" value={issue.id} />
              <input type="hidden" name="status" value={issue.status === "ignored" ? "open" : "ignored"} />
              <Button type="submit" variant="outline" size="sm">
                {issue.status === "ignored" ? "Reopen" : "This is expected"}
              </Button>
            </form>
          )}
          {ctx.githubRepo ? (
            <Button asChild variant="ghost" size="sm">
              <a href={githubNewIssueUrl(ctx.githubRepo, issue.title, md)} target="_blank" rel="noreferrer">
                Open GitHub issue
              </a>
            </Button>
          ) : (
            <CopyButton text={md} label="Copy as Markdown" />
          )}
        </div>
      )}
      <RecheckNote issue={issue} ctx={ctx} check={check} />
      <WhatHappened issue={issue} review={review} ctx={ctx} />
      <Repro issue={issue} flow={flowRow?.definition} result={result} at={d.stepIndex ?? review?.data.stepIndex} />
      <Video src={video} />
      <Screenshot src={shot} alt={`Screenshot: ${issue.title}`} compact={!!video} />
      {(d.evidence.console ?? result?.console ?? d.evidence.rpc ?? result?.rpc) && (
        <div className="flex flex-col gap-2">
          <ConsoleLog entries={d.evidence.console ?? result?.console} />
          <RpcLog entries={d.evidence.rpc ?? result?.rpc} />
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
          <Cell kind={kind} label />
          <span>
            {edgeCaseInfo(run.edgeCase).label} · {r.mode === "live" ? "live" : "fork"} · {dateTime(run.createdAt)}
          </span>
        </>
      }
      title={flowRow?.name ?? "Deleted flow"}
    >
      <p className="text-muted-foreground">{edgeCaseInfo(run.edgeCase).description}</p>
      {r.reason && <p className={cx("rounded-lg px-4 py-3", run.status === "fail" ? "bg-bad-soft text-bad-ink" : "bg-muted")}>{r.reason}</p>}

      {issueRows.length > 0 && (
        <PanelSection title="Issues in this run">
          <ul className="divide-y rounded-lg border">
            {issueRows.map((i) => (
              <li key={i.id}>
                <Link href={ctx.panelHref(`issue.${i.id}`)} scroll={false} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
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
          <ul className="divide-y rounded-lg border">
            {reviewRows.map((v) => (
              <li key={v.id}>
                <Link href={ctx.panelHref(`review.${v.id}`)} scroll={false} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
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
          <ol className="divide-y rounded-lg border">
            {steps.map((s, i) => {
              const res = results.get(i);
              return (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 text-right text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    {describeStep(s)}
                    {res?.error && <span className="mt-1 block text-xs text-bad">{res.error}</span>}
                  </span>
                  <span className={cx("shrink-0 text-xs", res?.status === "fail" ? "text-bad" : "text-muted-foreground")}>
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
        <div className="flex flex-wrap items-center gap-3 border-t pt-5">
          <RerunButton ctx={ctx} flowId={flowRow?.id} edgeCase={run.edgeCase} label="Re-run" />
          <span className="text-xs text-muted-foreground">
            {RUN_STATUS_LABEL[run.status]} · run {run.id}
          </span>
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
            <Link href={`/apps/${ctx.appId}/signing/${row.id}`} className="text-foreground underline-offset-4 hover:underline">
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
