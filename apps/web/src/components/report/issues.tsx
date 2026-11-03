import { CATEGORY_LABEL, edgeCaseInfo } from "@dappdrill/core";
import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { rerunAction } from "@/actions/results";
import { cx, SeverityTag } from "@/components/common";
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

export type Side = { label: string; children: ReactNode; bad?: boolean };

/** Facts side by side in one card, e.g. what should have happened and what did. Stacks on phones. */
export function Compare({ sides, footer }: { sides: Side[]; footer?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={cx("grid divide-y", sides.length > 1 && "sm:grid-cols-2 sm:divide-x sm:divide-y-0")}>
        {sides.map((s) => (
          <div key={s.label} className={cx("flex min-w-0 flex-col gap-1.5 px-4 py-3", s.bad && "bg-bad-soft/60")}>
            <span className={cx("text-xs", s.bad ? "text-bad-ink" : "text-muted-foreground")}>{s.label}</span>
            <div className="min-w-0 break-words">{s.children}</div>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}

type Asked =
  | { kind: "message"; message: string }
  | { kind: "typed"; method: string; type: string; fields: [string, string][] }
  | { kind: "call"; fn: string; args: string; to?: string; value?: string }
  | { kind: "text"; text: string };

/** The engine describes a wallet request in one line; split it back into its parts. */
function parseAsked(s: string): Asked {
  const msg = s.match(/^personal_sign of "([\s\S]*)"$/);
  if (msg) return { kind: "message", message: msg[1]! };
  const typed = s.match(/^(eth_signTypedData\w*)\s+(\w+)(?:\s*\{([\s\S]*)\})?$/);
  if (typed) {
    const fields = (typed[3] ?? "")
      .split(/,\s*(?=\w+:)/)
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f): [string, string] => [f.slice(0, f.indexOf(":")), f.slice(f.indexOf(":") + 1).trim()]);
    return { kind: "typed", method: typed[1]!, type: typed[2]!, fields };
  }
  const call = s.match(/^(\w+)\(([\s\S]*)\)(?: to (\S+))?(?: with (.+))?$/);
  if (call) return { kind: "call", fn: call[1]!, args: call[2]!, to: call[3], value: call[4] };
  return { kind: "text", text: s };
}

/** A wallet request as a heading (what kind of request) and its fields. */
export function WalletAsked({ asked }: { asked: string }) {
  const a = parseAsked(asked);
  if (a.kind === "text") return <span className="font-medium">{a.text}</span>;
  const head = a.kind === "message" ? "Sign a message" : a.kind === "typed" ? a.type : "Transaction";
  const method = a.kind === "message" ? "personal_sign" : a.kind === "typed" ? a.method : "eth_sendTransaction";
  const rows: [string, string][] =
    a.kind === "typed" ? a.fields : a.kind === "call" ? ([["call", `${a.fn}(${a.args})`], ["to", a.to], ["value", a.value]].filter(([, v]) => v) as [string, string][]) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{head}</span>
        <code className="text-xs opacity-70">{method}</code>
      </div>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="opacity-70">{k}</dt>
              <dd className="break-all">{v}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {a.kind === "message" && <blockquote className="border-l-2 border-current/20 pl-3 text-sm whitespace-pre-wrap">{a.message}</blockquote>}
    </div>
  );
}

/** "The button said" vs "The wallet was asked for". Red only when the request is the problem. */
export function SaidVsAsked({ said, asked, bad = true }: { said?: string; asked?: string; bad?: boolean }) {
  if (!said && !asked) return null;
  return (
    <Compare
      sides={[
        { label: "The button said", children: <span className="font-medium">{said ? `“${said}”` : "—"}</span> },
        { label: "The wallet was asked for", children: asked ? <WalletAsked asked={asked} /> : "—", bad },
      ]}
    />
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
