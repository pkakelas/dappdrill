import { edgeCaseInfo } from "@dappdrill/core";
import type { runBatches, scans } from "@dappdrill/db";
import { Check, CircleStop, Radar, Repeat, X } from "lucide-react";
import { cx, ListItem, RowLink, SeverityTag } from "@/components/common";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { dateTime, minutesBetween, plural, timeAgo } from "@/lib/format";
import type { Outcome } from "@/lib/queries";

/** A scan or a replay batch, named by what it found rather than by its number. */
export type Activity = {
  id: string;
  href: string;
  kind: "scan" | "replay";
  /** "Manual scan", "CI replay". */
  via: string;
  title: string;
  sub: string;
  commit?: string | null;
  branch?: string | null;
  status: string;
  at: Date;
  outcome?: Outcome;
};

const TRIGGER = { manual: "Manual", schedule: "Scheduled", ci: "CI" } as const;
const UNFINISHED = new Set(["failed", "stopped"]);

function outcomeTitle(status: string, o: Outcome | undefined, kind: Activity["kind"]): string {
  if (status === "queued") return "Waiting to start";
  if (status === "running") return kind === "scan" ? "Scanning now" : "Running now";
  if (status === "failed") return "Couldn't finish";
  if (status === "stopped") return "Stopped before finishing";
  const fresh = o?.fresh ?? 0;
  const fixed = o?.fixed ?? 0;
  if (fresh && fixed) return `Found ${plural(fresh, "new issue")}, confirmed ${fixed} fixed`;
  if (fresh) return `Found ${plural(fresh, "new issue")}`;
  if (fixed) return `Confirmed ${plural(fixed, "fix", "fixes")}`;
  return "Nothing new";
}

/** Merge scans and replay batches into one list, newest first. Runs of unfinished ones fold into a single row. */
export function buildActivity({
  appId,
  scanRows,
  batchRows,
  outcomes,
  flowsFound,
  flowNames,
}: {
  appId: string;
  scanRows: (typeof scans.$inferSelect)[];
  batchRows: (typeof runBatches.$inferSelect)[];
  outcomes: Map<string, Outcome>;
  flowsFound: (scanId: string) => number;
  flowNames: Map<string, string>;
}): Activity[] {
  const all: Activity[] = [
    ...scanRows.map((s) => {
      const found = flowsFound(s.id);
      return {
        id: s.id,
        href: `/apps/${appId}/scans/${s.id}`,
        kind: "scan" as const,
        via: `${TRIGGER[s.trigger]} scan`,
        title: outcomeTitle(s.status, outcomes.get(s.id), "scan"),
        sub: [`${TRIGGER[s.trigger]} scan`, found ? `${plural(found, "flow")} found` : null, s.finishedAt ? minutesBetween(s.startedAt, s.finishedAt) : null].filter(Boolean).join(" · "),
        status: s.status,
        at: s.createdAt,
        outcome: outcomes.get(s.id),
      };
    }),
    ...batchRows.map((b) => {
      const ids = b.request.flowIds;
      const cases = b.request.edgeCases;
      const what = ids.length === 1 ? (flowNames.get(ids[0]!) ?? "Deleted flow") : plural(ids.length, "flow");
      const edge = cases.length === 1 && cases[0] !== "happy" ? edgeCaseInfo(cases[0]!).label : null;
      return {
        id: b.id,
        href: `/apps/${appId}/runs/${b.id}`,
        kind: "replay" as const,
        via: `${TRIGGER[b.trigger]} replay`,
        title: outcomeTitle(b.status, outcomes.get(b.id), "replay"),
        sub: [`${TRIGGER[b.trigger]} replay`, what, edge, b.finishedAt ? minutesBetween(b.startedAt, b.finishedAt) : null].filter(Boolean).join(" · "),
        commit: b.request.commit,
        branch: b.request.branch,
        status: b.status,
        at: b.createdAt,
        outcome: outcomes.get(b.id),
      };
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // "Stopped, stopped, stopped" says one thing; show it once with a count.
  const out: (Activity & { folded?: Activity[] })[] = [];
  for (const a of all) {
    const prev = out.at(-1);
    if (prev && UNFINISHED.has(a.status) && prev.status === a.status && prev.kind === a.kind) (prev.folded ??= [prev]).push(a);
    else out.push(a);
  }
  return out.map(({ folded, ...a }) =>
    folded
      ? {
          ...a,
          title: `${plural(folded.length, a.kind)} ${a.status === "failed" ? "couldn't finish" : "stopped before finishing"}`,
          sub: [...new Set(folded.map((f) => f.via))].join(", "),
        }
      : a,
  );
}

/** The leading mark: what kind of run it was, coloured only when it found something. */
function Mark({ a }: { a: Activity }) {
  const live = a.status === "queued" || a.status === "running";
  const unfinished = UNFINISHED.has(a.status);
  const sev = a.outcome?.topNew?.severity;
  const Icon = unfinished ? (a.status === "failed" ? X : CircleStop) : a.kind === "scan" ? Radar : Repeat;
  return (
    <ItemMedia
      className={cx(
        "size-8 rounded-md [&_svg]:size-4",
        live ? "bg-live-bg text-live-ink" : sev === "critical" || sev === "high" ? "bg-bad-bg text-bad" : sev ? "bg-warn-bg text-warn-icon" : "bg-muted text-muted-foreground",
        unfinished && "text-muted-foreground/70",
      )}
    >
      <Icon className={cx(live && "animate-pulse")} aria-hidden />
    </ItemMedia>
  );
}

/** One line under the title naming what changed: the worst new issue, or the issue it confirmed fixed. */
function Preview({ o }: { o?: Outcome }) {
  if (o?.topNew)
    return (
      <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <SeverityTag severity={o.topNew.severity} />
        <span className="truncate text-foreground/80">{o.topNew.title}</span>
        {o.fresh > 1 && <span className="shrink-0">+{o.fresh - 1}</span>}
      </span>
    );
  if (o?.topFixed)
    return (
      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5 shrink-0" aria-label="Fixed" />
        <span className="truncate line-through decoration-muted-foreground/50">{o.topFixed.title}</span>
        {o.fixed > 1 && <span className="shrink-0">+{o.fixed - 1}</span>}
      </span>
    );
  return null;
}

export function ActivityItem({ a }: { a: Activity }) {
  const quiet = UNFINISHED.has(a.status);
  return (
    <ListItem>
      <Mark a={a} />
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className={cx("w-full min-w-0", quiet && "font-normal text-muted-foreground")}>
          <RowLink href={a.href} className="truncate">
            {a.title}
          </RowLink>
        </ItemTitle>
        <ItemDescription className="line-clamp-1 text-xs">
          {a.sub}
          {(a.commit || a.branch) && (
            <span className="ml-1.5 font-mono">
              {a.commit?.slice(0, 7)} {a.branch}
            </span>
          )}
        </ItemDescription>
        <Preview o={a.outcome} />
      </ItemContent>
      <ItemActions className="pointer-events-none self-start pt-0.5">
        <span className="text-xs text-muted-foreground" title={dateTime(a.at)}>
          {timeAgo(a.at)}
        </span>
      </ItemActions>
    </ListItem>
  );
}
