import { CATEGORY_LABEL, edgeCaseInfo } from "@dappdrill/core";
import Link from "next/link";
import { rerunAction } from "@/actions/results";
import { ActionButton, ChevronIcon, Pill, PlayIcon, SeverityTag } from "@/components/ui";
import type { IssueRow } from "@/lib/queries";
import type { ViewCtx } from "./ctx";

export function issueMeta(issue: IssueRow, flowName?: string): string {
  const d = issue.data;
  return [CATEGORY_LABEL[issue.category], flowName ?? d.flowName, d.edgeCase && d.edgeCase !== "happy" ? edgeCaseInfo(d.edgeCase).label : null].filter(Boolean).join(" · ");
}

export function RerunButton({ ctx, flowId, edgeCase, label = "Re-run this flow", small }: { ctx: ViewCtx; flowId?: string | null; edgeCase?: string; label?: string; small?: boolean }) {
  if (ctx.readOnly || !flowId) return null;
  return (
    <ActionButton action={rerunAction} fields={{ appId: ctx.appId, flowId, edgeCase }} className={small ? "btn-xs" : "btn-sm"} pendingText="Queuing…">
      {label}
    </ActionButton>
  );
}

/** "The button said" vs "The wallet was asked for". */
export function SaidVsAsked({ said, asked }: { said?: string; asked?: string }) {
  if (!said && !asked) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 rounded-lg bg-sub px-4 py-3.5">
        <span className="label">The button said</span>
        <span className="text-body font-medium">{said ? `“${said}”` : "—"}</span>
      </div>
      <div className="flex flex-col gap-1.5 rounded-lg bg-bad-soft px-4 py-3.5">
        <span className="label text-bad-ink">The wallet was asked for</span>
        <span className="font-mono text-sm font-medium break-words">{asked ?? "—"}</span>
      </div>
    </div>
  );
}

export function CriticalIssueCard({ issue, ctx, flowName, reviewHref }: { issue: IssueRow; ctx: ViewCtx; flowName?: string; reviewHref?: string | null }) {
  const d = issue.data;
  return (
    <article className="card overflow-hidden border-bad-line">
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <SeverityTag severity={issue.severity} />
          <span className="meta">{issueMeta(issue, flowName)}</span>
          {issue.status === "ignored" && <Pill>Marked expected</Pill>}
        </div>
        <h3 className="title">{issue.title}</h3>
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
    <article className="card relative flex flex-wrap items-center gap-4 px-5 py-4 transition-colors has-[.stretched:hover]:bg-sub sm:px-6">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <SeverityTag severity={issue.severity} />
          <span className="meta">{issueMeta(issue, flowName)}</span>
          {issue.data.unverified && <Pill>Unverified</Pill>}
          {issue.status === "ignored" && <Pill>Marked expected</Pill>}
        </div>
        <h3 className="m-0 text-lead font-medium">
          <Link href={ctx.panelHref(`issue.${issue.id}`)} scroll={false} className="stretched no-underline">
            {issue.title}
          </Link>
        </h3>
      </div>
      <span className="meta flex items-center gap-1.5" aria-hidden="true">
        <PlayIcon />
        Replay and details
        <ChevronIcon className="-rotate-90" />
      </span>
    </article>
  );
}
