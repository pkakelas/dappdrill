import { CATEGORY_LABEL, edgeCaseInfo } from "@dappdrill/core";
import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { rerunAction } from "@/actions/results";
import { SeverityTag } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { IssueRow } from "@/lib/queries";
import type { ViewCtx } from "./ctx";

export function issueMeta(issue: IssueRow, flowName?: string): string {
  const d = issue.data;
  return [CATEGORY_LABEL[issue.category], flowName ?? d.flowName, d.edgeCase && d.edgeCase !== "happy" ? edgeCaseInfo(d.edgeCase).label : null].filter(Boolean).join(" · ");
}

/** `back` keeps the user where they are (the run reports there) instead of opening the run page. */
export function RerunButton({ ctx, flowId, edgeCase, label = "Re-run this flow", small, back }: { ctx: ViewCtx; flowId?: string | null; edgeCase?: string; label?: string; small?: boolean; back?: string }) {
  if (ctx.readOnly || !flowId) return null;
  return (
    <form action={rerunAction}>
      <input type="hidden" name="appId" value={ctx.appId} />
      <input type="hidden" name="flowId" value={flowId} />
      {edgeCase && <input type="hidden" name="edgeCase" value={edgeCase} />}
      {back && <input type="hidden" name="back" value={back} />}
      <Button type="submit" variant="outline" size={small ? "xs" : "sm"}>
        {label}
      </Button>
    </form>
  );
}

export function StatusBadge({ status }: { status: IssueRow["status"] }) {
  if (status === "ignored") return <Badge variant="secondary">Marked expected</Badge>;
  if (status === "fixed") return <Badge variant="secondary">Fixed</Badge>;
  return null;
}

/** "The button said" vs "The wallet was asked for". */
export function SaidVsAsked({ said, asked }: { said?: string; asked?: string }) {
  if (!said && !asked) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 rounded-lg bg-muted px-4 py-3">
        <span className="text-xs text-muted-foreground">The button said</span>
        <span className="font-medium">{said ? `“${said}”` : "—"}</span>
      </div>
      <div className="flex flex-col gap-1 rounded-lg bg-bad-soft px-4 py-3">
        <span className="text-xs text-bad-ink">The wallet was asked for</span>
        <span className="font-mono font-medium break-words">{asked ?? "—"}</span>
      </div>
    </div>
  );
}

function Meta({ issue, flowName }: { issue: IssueRow; flowName?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SeverityTag severity={issue.severity} />
      <span className="text-muted-foreground">{issueMeta(issue, flowName)}</span>
      {issue.data.unverified && <Badge variant="secondary">Unverified</Badge>}
      <StatusBadge status={issue.status} />
    </div>
  );
}

export function CriticalIssueCard({ issue, ctx, flowName, reviewHref }: { issue: IssueRow; ctx: ViewCtx; flowName?: string; reviewHref?: string | null }) {
  const d = issue.data;
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-bad-line bg-card p-5 shadow-xs">
      <Meta issue={issue} flowName={flowName} />
      <h3 className="text-lg leading-snug font-semibold">{issue.title}</h3>
      <SaidVsAsked said={d.evidence.buttonLabel} asked={d.evidence.walletAsked} />
      <p className="leading-relaxed text-muted-foreground">{d.summary}</p>
      <div className="flex flex-wrap gap-2">
        {reviewHref && (
          <Button asChild size="sm">
            <Link href={reviewHref} scroll={false}>
              Open signing review
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={ctx.panelHref(`issue.${issue.id}`)} scroll={false}>
            <Play /> Watch replay
          </Link>
        </Button>
        <RerunButton ctx={ctx} flowId={issue.flowId} edgeCase={d.edgeCase} />
      </div>
    </article>
  );
}

export function IssueRowCard({ issue, ctx, flowName }: { issue: IssueRow; ctx: ViewCtx; flowName?: string }) {
  return (
    <Link href={ctx.panelHref(`issue.${issue.id}`)} scroll={false} className="group flex items-center gap-4 rounded-xl border bg-card px-5 py-4 shadow-xs hover:bg-muted/50">
      <article className="flex min-w-0 flex-1 flex-col gap-2">
        <Meta issue={issue} flowName={flowName} />
        <h3 className="font-medium">{issue.title}</h3>
      </article>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-label="Show details" />
    </Link>
  );
}
