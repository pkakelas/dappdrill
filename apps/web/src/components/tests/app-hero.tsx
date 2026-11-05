import { signingText, type AppRollup } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { RunHistory } from "./app-stats";
import { SigningFlag } from "./signing-flag";
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

/** Whatever the headline left out. */
function Notes({ rollup, running }: { rollup: AppRollup; running: number }) {
  const { failed, couldntRun, notRun } = rollup.tests;
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
  if (signingText(rollup.signing)) notes.push(<SigningFlag key="signing" signing={rollup.signing} />);
  if (notRun > 0 && notRun < rollup.tests.total) notes.push(<span key="not-run">{notRun} not run yet</span>);
  if (rollup.untested > 0) notes.push(<span key="untested">{rollup.untested} not tested yet</span>);
  if (notes.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted-foreground">
      {notes.flatMap((n, i) => (i === 0 ? [n] : [<span key={`dot-${i}`} aria-hidden="true">·</span>, n]))}
    </p>
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
