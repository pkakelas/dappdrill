import { CATEGORY_LABEL, edgeCaseInfo } from "@dappdrill/core";
import Link from "next/link";
import { rerunAction } from "@/actions/results";
import { ChevronIcon, cx, PlayIcon, SeverityTag } from "@/components/ui";
import type { IssueRow } from "@/lib/queries";
import type { ViewCtx } from "./ctx";

export function issueMeta(issue: IssueRow, flowName?: string): string {
  const d = issue.data;
  return [CATEGORY_LABEL[issue.category], flowName ?? d.flowName, d.edgeCase && d.edgeCase !== "happy" ? edgeCaseInfo(d.edgeCase).label : null].filter(Boolean).join(" · ");
}

export function RerunButton({ ctx, flowId, edgeCase, label = "Re-run this flow", small }: { ctx: ViewCtx; flowId?: string | null; edgeCase?: string; label?: string; small?: boolean }) {
  if (ctx.readOnly || !flowId) return null;
  return (
    <form action={rerunAction}>
      <input type="hidden" name="appId" value={ctx.appId} />
      <input type="hidden" name="flowId" value={flowId} />
      {edgeCase && <input type="hidden" name="edgeCase" value={edgeCase} />}
      <button type="submit" className={cx("btn", small ? "btn-xs" : "btn-sm")}>
        {label}
      </button>
    </form>
  );
}

/** "The button said" vs "The wallet was asked for". */
export function SaidVsAsked({ said, asked }: { said?: string; asked?: string }) {
  if (!said && !asked) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 rounded-[10px] bg-sub px-4 py-3.5">
        <span className="text-xs text-muted">The button said</span>
        <span className="text-[15px] font-medium">{said ? `“${said}”` : "—"}</span>
      </div>
      <div className="flex flex-col gap-1.5 rounded-[10px] bg-bad-soft px-4 py-3.5">
        <span className="text-xs text-bad-ink">The wallet was asked for</span>
        <span className="font-mono text-[14px] font-medium break-words">{asked ?? "—"}</span>
      </div>
    </div>
  );
}

export function CriticalIssueCard({ issue, ctx, flowName, reviewHref }: { issue: IssueRow; ctx: ViewCtx; flowName?: string; reviewHref?: string | null }) {
  const d = issue.data;
  return (
    <article className="overflow-hidden rounded-xl border border-line-strong bg-white">
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <SeverityTag severity={issue.severity} />
          <span className="text-[13px] text-muted">{issueMeta(issue, flowName)}</span>
          {issue.status === "ignored" && <span className="pill bg-hair text-muted">Marked expected</span>}
        </div>
        <h3 className="m-0 text-[19px] leading-snug font-semibold">{issue.title}</h3>
        <SaidVsAsked said={d.evidence.buttonLabel} asked={d.evidence.walletAsked} />
        <p className="m-0 text-sm leading-relaxed text-ink-2">{d.summary}</p>
        <div className="flex flex-wrap gap-2">
          {reviewHref && (
            <Link href={reviewHref} scroll={false} className="btn btn-sm btn-primary">
              Open signing review
            </Link>
          )}
          <Link href={ctx.panelHref(`issue.${issue.id}`)} scroll={false} className="btn btn-sm">
            <PlayIcon />
            Watch replay
          </Link>
          <RerunButton ctx={ctx} flowId={issue.flowId} edgeCase={d.edgeCase} />
        </div>
      </div>
    </article>
  );
}

export function IssueRowCard({ issue, ctx, flowName }: { issue: IssueRow; ctx: ViewCtx; flowName?: string }) {
  return (
    <article className="card flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <SeverityTag severity={issue.severity} />
          <span className="text-[13px] text-muted">{issueMeta(issue, flowName)}</span>
          {issue.data.unverified && <span className="pill bg-hair text-muted">Unverified</span>}
          {issue.status === "ignored" && <span className="pill bg-hair text-muted">Marked expected</span>}
        </div>
        <h3 className="m-0 text-base font-semibold">
          <Link href={ctx.panelHref(`issue.${issue.id}`)} scroll={false} className="no-underline hover:underline">
            {issue.title}
          </Link>
        </h3>
      </div>
      <div className="flex gap-2">
        <Link href={ctx.panelHref(`issue.${issue.id}`)} scroll={false} className="btn btn-sm">
          <PlayIcon />
          Replay
        </Link>
        <Link href={ctx.panelHref(`issue.${issue.id}`)} scroll={false} className="btn btn-sm btn-icon" aria-label="Show details">
          <ChevronIcon className="-rotate-90" />
        </Link>
      </div>
    </article>
  );
}
