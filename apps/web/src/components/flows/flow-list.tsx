import "server-only";
import type { RunStatus, Step } from "@dappdrill/core";
import { db, repairs } from "@dappdrill/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, Check, ChevronRight, Circle, Minus, PenLine, Play, Wrench, X } from "lucide-react";
import { rerunAction } from "@/actions/results";
import { cx, ItemList, ListItem, RowLink, RUN_STATUS_TEXT, Sparkbars } from "@/components/common";
import { Button } from "@/components/ui/button";
import { ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { timeAgo } from "@/lib/format";
import { lastRuns, recentStatuses, type FlowRow } from "@/lib/queries";

/** Everything the flow list shows besides the flows themselves. */
export async function flowTableData(flowRows: FlowRow[]) {
  const ids = flowRows.map((f) => f.id);
  const [statuses, last, openRepairs] = await Promise.all([
    recentStatuses(ids),
    lastRuns(ids),
    ids.length ? db().select().from(repairs).where(and(inArray(repairs.flowId, ids), eq(repairs.status, "open"))).orderBy(desc(repairs.createdAt)) : [],
  ]);
  return { statuses, last, openRepairs };
}

export type FlowTableData = Awaited<ReturnType<typeof flowTableData>>;

type Mark = { icon: typeof Check; label: string; cls: string };

const MARK: Record<RunStatus | "fix" | "none", Mark> = {
  pass: { icon: Check, label: "Passed", cls: "bg-foreground/5 text-muted-foreground" },
  issue: { icon: AlertTriangle, label: "Issue", cls: "bg-warn-bg text-warn-icon" },
  fail: { icon: X, label: "Failed", cls: "bg-bad-bg text-bad" },
  error: { icon: X, label: "Error", cls: "bg-foreground/5 text-foreground" },
  skipped: { icon: Minus, label: "Skipped", cls: "bg-foreground/5 text-muted-foreground" },
  fix: { icon: Wrench, label: "Needs a fix", cls: "bg-warn-bg text-warn-icon" },
  none: { icon: Circle, label: "Not run yet", cls: "bg-foreground/5 text-muted-foreground/60" },
};

const CONNECT = /connect|wallet picker|^choose (metamask|rabby|coinbase|rainbow|walletconnect)/i;
const TRAIL_MAX = 5;

/**
 * The flow as a short path of what the user does: clicks, typing and wallet
 * prompts. Navigation, waits and assertions are left out, and the opening
 * wallet-connect clicks fold into one "Connect".
 */
function trail(steps: Step[]): { label: string; wallet?: boolean }[] {
  const out: { label: string; wallet?: boolean }[] = [];
  for (const s of steps) {
    if (s.kind === "goto" || s.kind === "wait" || s.kind === "expect") continue;
    if (s.kind === "wallet") {
      // A bare 4-byte selector says nothing to a reader, so fall back to "Approve".
      const fn = s.expect?.functionName;
      out.push({ label: s.respond === "reject" ? "Reject" : fn && !fn.startsWith("0x") ? fn : "Approve", wallet: true });
      continue;
    }
    const name = "target" in s && s.target ? (s.target.name ?? s.target.text ?? s.target.label ?? s.target.placeholder) : undefined;
    const label =
      s.note ?? (s.kind === "fill" ? `Enter ${s.value}` : s.kind === "select" ? s.value : s.kind === "press" ? s.key : s.kind === "email-code" ? "Email code" : (name ?? "Click"));
    if (out.length === 0 || (out.length === 1 && out[0]!.label === "Connect")) {
      if (CONNECT.test(label) || ("target" in s && s.target?.withinDialog)) {
        if (out.length === 0) out.push({ label: "Connect" });
        continue;
      }
    }
    out.push({ label });
  }
  // "{{amount}}" reads as "amount"; function names start lowercase.
  return out.map((t) => {
    const label = t.label.replace(/\{\{(\w+)\}\}/g, "$1");
    return { ...t, label: label.charAt(0).toUpperCase() + label.slice(1) };
  });
}

export function FlowList({ appId, flows, data, className }: { appId: string; flows: FlowRow[]; data: FlowTableData; className?: string }) {
  const needsFix = new Set(data.openRepairs.map((r) => r.flowId));
  return (
    <ItemList className={className}>
      {flows.map((f) => {
        const l = data.last.get(f.id);
        const key = needsFix.has(f.id) ? "fix" : (l?.status ?? "none");
        const mark = MARK[key];
        const quiet = key === "pass" || key === "skipped" || key === "none";
        const path = trail(f.definition.steps);
        const shown = path.slice(0, TRAIL_MAX);
        return (
          <ListItem key={f.id}>
            <ItemMedia className={cx("size-8 rounded-md [&_svg]:size-4", mark.cls)} title={mark.label}>
              <mark.icon aria-label={mark.label} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="w-full min-w-0">
                <RowLink href={`/apps/${appId}/flows/${f.id}`} className="truncate">
                  {f.name}
                </RowLink>
              </ItemTitle>
              <ol aria-label="Steps" className="flex min-w-0 items-center gap-1 overflow-hidden text-xs whitespace-nowrap text-muted-foreground [mask-image:linear-gradient(to_right,black_85%,transparent)]">
                {shown.map((s, i) => (
                  <li key={i} className="flex min-w-0 shrink-0 items-center gap-1 last:shrink">
                    {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-50" aria-hidden />}
                    <span className="flex max-w-40 items-center gap-1 truncate rounded-sm bg-foreground/5 px-1.5 py-px">
                      {s.wallet && <PenLine className="size-3 shrink-0" aria-label="Wallet prompt" />}
                      <span className="truncate">{s.label}</span>
                    </span>
                  </li>
                ))}
                {path.length > TRAIL_MAX && <li className="shrink-0 pl-1">+{path.length - TRAIL_MAX}</li>}
              </ol>
            </ItemContent>
            <ItemActions className="gap-4">
              <span className="pointer-events-none hidden text-right text-xs sm:block">
                {!quiet && <span className={key === "fix" ? "text-warn" : RUN_STATUS_TEXT[key]}>{mark.label} · </span>}
                <span className="text-muted-foreground">{l ? timeAgo(l.at) : "Not run yet"}</span>
              </span>
              <span className="pointer-events-none hidden sm:block">
                <Sparkbars statuses={data.statuses.get(f.id) ?? []} />
              </span>
              <form action={rerunAction}>
                <input type="hidden" name="appId" value={appId} />
                <input type="hidden" name="flowId" value={f.id} />
                <Button type="submit" variant="ghost" size="icon-sm" aria-label={`Run ${f.name}`} title="Run this flow" className="sm:opacity-0 sm:group-hover/item:opacity-100 sm:focus-visible:opacity-100">
                  <Play />
                </Button>
              </form>
            </ItemActions>
          </ListItem>
        );
      })}
    </ItemList>
  );
}
