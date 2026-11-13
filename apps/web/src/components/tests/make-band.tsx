import type { MakeGoal } from "@dappdrill/core";
import type { makes } from "@dappdrill/db";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { stopMakeAction } from "@/actions/tests";
import { Elapsed } from "@/components/elapsed";
import { BrowserWindow, SiteLoading } from "@/components/site-preview";
import { SubmitButton } from "@/components/submit-button";
import { cx } from "@/components/ui";
import { Spinner } from "@/components/ui/spinner";
import { artifactUrl } from "@/lib/artifacts";
import { plural } from "@/lib/format";
import { StateMark, type TestState } from "./status";
import { Tile } from "./tile";

type MakeRow = typeof makes.$inferSelect;

const GOAL_MARK: Record<MakeGoal["status"], TestState> = { waiting: "never", making: "running", kept: "passed", "not-kept": "stopped" };

function goalMark(g: MakeGoal): { state: TestState; label: string } {
  if (g.status === "kept") return g.stands === "failed" ? { state: "failed", label: "Kept: it fails on a bug" } : { state: "passed", label: "Kept: it passes" };
  return { state: GOAL_MARK[g.status], label: { waiting: "Waiting", making: "Being made", "not-kept": "No test kept" }[g.status] };
}

/** What a goal came to, in a few words on its right. */
function goalStatus(g: MakeGoal) {
  if (g.status === "making") return <span className="text-live">Making</span>;
  if (g.status === "kept") return g.stands === "failed" ? <span className="text-bad">Found a bug</span> : <span className="text-good">Test kept</span>;
  if (g.status === "not-kept") return "No test";
  return "Waiting";
}

const found = (g: MakeGoal) => g.status === "kept" && g.stands === "failed";

/** The reason two or more goals got no test for, when there is one: it is said once, above them. */
function sharedReason(goals: MakeGoal[]): { why: string; count: number } | undefined {
  const counts = new Map<string, number>();
  for (const g of goals) if (g.status === "not-kept" && g.whyNot) counts.set(g.whyNot, (counts.get(g.whyNot) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  return top && top[1] > 1 ? { why: top[0], count: top[1] } : undefined;
}

/** The goals a make is working through, each with what came of it. A kept one links to its test. */
export function GoalList({ appId, goals, live }: { appId: string; goals: MakeGoal[]; live?: boolean }) {
  const shared = sharedReason(goals);
  return (
    <div className="flex flex-col gap-1">
      {shared && (
        <div role="status" className="mx-2 mt-1 mb-2 flex items-start gap-3 rounded-lg bg-warn-soft p-3 text-sm">
          <Tile icon={TriangleAlert} tint="warn" className="size-7 rounded-md" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">{shared.count} goals got no test, for the same reason</p>
            <p className="text-pretty text-muted-foreground">{shared.why}</p>
          </div>
        </div>
      )}
      <ol className="flex flex-col divide-y divide-border/60">
        {goals.map((g, i) => {
          const mark = goalMark(g);
          const whyNot = g.whyNot === shared?.why ? undefined : g.whyNot;
          const under = g.status === "making" ? g.said : g.status === "not-kept" ? whyNot : undefined;
          return (
            <li key={i} className="relative flex items-start gap-3 px-2 py-2.5 text-sm hover:bg-foreground/5">
              <StateMark state={mark.state} label={mark.label} className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {g.testId ? (
                  <Link href={`/apps/${appId}/tests/${g.testId}`} title={g.goal} className="line-clamp-2 text-pretty outline-none after:absolute after:inset-0 focus-visible:underline">
                    {g.goal}
                  </Link>
                ) : (
                  <span title={g.goal} className={cx("line-clamp-2 text-pretty", g.status === "waiting" && "text-muted-foreground")}>
                    {g.goal}
                  </span>
                )}
                {g.suspicion && <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">Looked wrong: {g.suspicion}</span>}
                {under && <span className={cx("text-xs text-pretty text-muted-foreground", live && "line-clamp-2", live && g.status === "making" && "text-live")}>{under}</span>}
              </div>
              <span className="w-20 shrink-0 pt-0.5 text-right text-xs text-muted-foreground">{goalStatus(g)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const SEGMENT: Record<MakeGoal["status"], string> = { waiting: "bg-foreground/10", making: "bg-live animate-pulse motion-reduce:animate-none", kept: "bg-good-bar", "not-kept": "bg-muted-foreground/40" };

/** One bar for each goal, in order, and what they came to so far in words. */
function GoalProgress({ goals }: { goals: MakeGoal[] }) {
  const count = (is: (g: MakeGoal) => boolean) => goals.filter(is).length;
  const kept = count((g) => g.status === "kept" && !found(g));
  const bugs = count(found);
  const none = count((g) => g.status === "not-kept");
  const waiting = count((g) => g.status === "waiting");
  const done = kept + bugs + none;
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={`${done} of ${plural(goals.length, "goal")} done`} className="flex gap-1">
        {goals.map((g, i) => (
          <span key={i} className={cx("h-1.5 flex-1 rounded-full", found(g) ? "bg-bad-mid" : SEGMENT[g.status])} />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {kept > 0 && <span className="text-good">{plural(kept, "test")} kept</span>}
        {bugs > 0 && <span className="text-bad">{plural(bugs, "bug")} found</span>}
        {none > 0 && <span>{none} without a test</span>}
        {waiting > 0 && <span>{waiting} to go</span>}
        {done === 0 && waiting === 0 && <span>Nothing finished yet</span>}
      </p>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-live" />
    </span>
  );
}

/** Tests being made, as it happens: what the browser sees, the goal in hand, and what came of the others. */
export function MakeBand({ appId, appUrl, make }: { appId: string; appUrl: string; make: MakeRow }) {
  const { state } = make;
  const queued = make.status === "queued";
  const n = state.goals.findIndex((g) => g.status === "making");
  const current = n >= 0 ? state.goals[n] : undefined;
  const frame = artifactUrl("makes", make.id, current?.frame ?? (current ? undefined : state.frame));
  const said = current?.said ?? (current ? undefined : state.said);
  const headline = queued ? "Waiting for a browser" : make.goal ? "Making your test" : state.stage === "looking" ? "Looking over the app" : current ? `Making test ${n + 1} of ${state.goals.length}` : "Finishing up";
  // The goal in hand is shown on its own, above the list, so it never scrolls out of sight.
  const others = state.goals.filter((g) => g !== current);

  return (
    <section aria-label="Making tests" className="grid gap-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-10">
      <BrowserWindow url={appUrl}>
        <div className="relative aspect-[16/10] overflow-hidden bg-card">
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frame} alt="What the browser sees right now" className="absolute inset-0 size-full object-cover object-top" />
          ) : (
            <SiteLoading />
          )}
          <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border bg-background/85 px-3 py-2 text-sm shadow-md backdrop-blur-md">
            {!frame && <Spinner className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{queued ? "Waiting for a browser…" : (said ?? `${headline}…`)}</span>
          </div>
        </div>
      </BrowserWindow>

      {/* On wide screens the browser sets the height. */}
      <div className="flex min-h-0 flex-col gap-4 md:h-0 md:min-h-full md:py-1">
        <div className="flex min-h-8 items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-2">
            <LiveDot />
            {queued ? "Queued" : state.stage === "looking" ? "Looking" : "Making tests"}
            {make.startedAt && (
              <>
                {" · "}
                <Elapsed since={make.startedAt.toISOString()} />
              </>
            )}
          </span>
          <form action={stopMakeAction.bind(null, make.id)}>
            <SubmitButton variant="outline" size="sm" busy="Stopping…" disabled={make.stopRequested}>
              {make.stopRequested ? "Stopping…" : "Stop"}
            </SubmitButton>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{headline}</h2>
          {state.goals.length > 1 && <GoalProgress goals={state.goals} />}
          {current ? (
            <div className="flex flex-col gap-1 rounded-lg bg-live-soft px-3 py-2.5 text-sm">
              <p title={current.goal} className="line-clamp-3 text-pretty">
                {current.goal}
              </p>
              {current.suspicion && <p className="line-clamp-2 text-xs text-pretty text-muted-foreground">Looked wrong: {current.suspicion}</p>}
              {current.said && <p className="line-clamp-2 text-xs text-pretty text-live">{current.said}</p>}
            </div>
          ) : (
            state.summary && <p className="line-clamp-3 text-sm text-pretty text-muted-foreground">{state.summary}</p>
          )}
        </div>

        {others.length > 0 && (
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto border-t pt-1">
            <GoalList appId={appId} goals={others} live />
          </div>
        )}
      </div>
    </section>
  );
}
