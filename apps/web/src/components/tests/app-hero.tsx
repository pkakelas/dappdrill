import type { AppRollup } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { RunHistory } from "./app-stats";
import { StateMark } from "./status";

/** The answer to "is my app OK?", as big as the page gets. The problem takes the colour, the rest of the line stays quiet. */
function Verdict({ rollup }: { rollup: AppRollup }) {
  const { failed, couldntRun, passed, total } = rollup.tests;
  const of = <span className="text-muted-foreground/70"> of {plural(total, "test")}</span>;
  if (failed > 0)
    return (
      <>
        <span className="text-bad">{failed} failed</span>
        {of}
      </>
    );
  if (couldntRun > 0)
    return (
      <>
        <span className="text-warn">{couldntRun} couldn&apos;t run</span>
        {of}
      </>
    );
  if (rollup.conditionsFailed > 0) return <span className="text-bad">{plural(rollup.conditionsFailed, "condition")} failed</span>;
  if (passed === 0) return <span className="text-muted-foreground">Not run yet</span>;
  if (passed === total) return <>{total === 1 ? "1 test passed" : `All ${total} tests passed`}</>;
  return (
    <>
      {passed} passed
      {of}
    </>
  );
}

/** Whatever the headline left out. A dangerous signature outranks the rest, so it gets a line of its own. */
function Notes({ rollup, running }: { rollup: AppRollup; running: number }) {
  const { failed, couldntRun, notRun, total } = rollup.tests;
  const { dangerous, check } = rollup.signing;
  // When nothing has run, the headline already says so.
  const waiting = notRun < total ? notRun + rollup.untested : 0;
  const notes: ReactNode[] = [];
  if (running > 0)
    notes.push(
      <span key="running" className="inline-flex items-center gap-1.5 text-live">
        <StateMark state="running" className="size-3" />
        Running {plural(running, "test")}
      </span>,
    );
  if (failed > 0 && couldntRun > 0) notes.push(<span key="error" className="text-warn">{couldntRun} couldn&apos;t run</span>);
  if ((failed > 0 || couldntRun > 0) && rollup.conditionsFailed > 0) notes.push(<span key="conditions" className="text-bad">{plural(rollup.conditionsFailed, "condition")} failed</span>);
  if (check > 0) notes.push(<span key="check" className="text-warn">{plural(check, "signature")} to check</span>);
  if (waiting > 0) notes.push(<span key="waiting">{waiting} not run yet</span>);
  if (dangerous === 0 && notes.length === 0) return null;
  return (
    <>
      {dangerous > 0 && (
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-bad-bg py-1 pr-3 pl-2 text-sm font-medium text-bad-ink">
          <TriangleAlert aria-hidden="true" className="size-4" />
          {plural(dangerous, "dangerous signature")}
        </p>
      )}
      {notes.length > 0 && <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">{notes}</p>}
    </>
  );
}

/** The top of an app: what it is, how it's doing, and the one action that matters. */
export function AppHero({ appId, name, url, lastRun, rollup, running, runs, action }: { appId: string; name: string; url: string; lastRun?: Date; rollup?: AppRollup; running: number; runs: RunSummary[]; action?: ReactNode }) {
  return (
    <header className="flex flex-col gap-8">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 text-sm text-muted-foreground">
          <h1 className="text-base font-semibold tracking-tight text-foreground">{name}</h1>
          <a href={url} target="_blank" rel="noreferrer" className="group/site inline-flex items-center gap-0.5 hover:text-foreground">
            {hostFromUrl(url)}
            <ArrowUpRight aria-hidden="true" className="size-3.5 opacity-60 transition-transform group-hover/site:translate-x-px group-hover/site:-translate-y-px" />
          </a>
          {lastRun && (
            <Link href={`/apps/${appId}/runs`} className="hover:text-foreground">
              Last run {timeAgo(lastRun)}
            </Link>
          )}
        </div>
        {action}
      </div>
      {rollup && (
        <div className="grid items-end gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex min-w-0 flex-col gap-3 lg:pb-1">
            <p className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              <Verdict rollup={rollup} />
            </p>
            <Notes rollup={rollup} running={running} />
          </div>
          <RunHistory runs={runs} />
        </div>
      )}
    </header>
  );
}
