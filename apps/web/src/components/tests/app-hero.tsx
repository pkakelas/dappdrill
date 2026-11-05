import type { AppRollup, WalletProfileId } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { ArrowUpRight, Check, CircleDashed, GitFork, PenLine, Play, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChainIcon, WalletIcon } from "@/components/web3-icons";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { RunHistory } from "./app-stats";
import { Tile, type TINT } from "./tile";

/** The answer to "is my app OK?", as big as the page gets. */
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
  if (passed === total) return <span className="text-good">{total === 1 ? "1 test passed" : `All ${total} tests passed`}</span>;
  return (
    <>
      <span className="text-good">{passed} passed</span>
      {of}
    </>
  );
}

/** The counts behind the headline, each with its own tile. */
function stats({ tests, conditionsFailed, signing, untested }: AppRollup, running: number) {
  const { passed, failed, couldntRun, notRun, total } = tests;
  // When nothing has run, the headline already says so.
  const waiting = notRun < total ? notRun + untested : 0;
  const items: { icon: LucideIcon; tint: keyof typeof TINT; n: number; label: string }[] = [];
  if (running > 0) items.push({ icon: Play, tint: "live", n: running, label: "Running now" });
  if (signing.dangerous > 0) items.push({ icon: PenLine, tint: "bad", n: signing.dangerous, label: signing.dangerous === 1 ? "Dangerous signature" : "Dangerous signatures" });
  if (failed > 0 && couldntRun > 0) items.push({ icon: TriangleAlert, tint: "warn", n: couldntRun, label: "Couldn't run" });
  if ((failed > 0 || couldntRun > 0) && conditionsFailed > 0) items.push({ icon: GitFork, tint: "fork", n: conditionsFailed, label: conditionsFailed === 1 ? "Condition failed" : "Conditions failed" });
  if (signing.check > 0) items.push({ icon: PenLine, tint: "warn", n: signing.check, label: signing.check === 1 ? "Signature to check" : "Signatures to check" });
  if (passed > 0 && passed < total) items.push({ icon: Check, tint: "good", n: passed, label: "Passed" });
  if (waiting > 0) items.push({ icon: CircleDashed, tint: "quiet", n: waiting, label: "Not run yet" });
  return items;
}

function Stats({ rollup, running }: { rollup: AppRollup; running: number }) {
  const items = stats(rollup, running);
  if (items.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
      {items.map(({ icon, tint, n, label }) => (
        <li key={label} className="flex min-w-0 items-center gap-2.5">
          <Tile icon={icon} tint={tint} />
          <p className="flex min-w-0 flex-col">
            <span className="text-base leading-tight font-semibold tabular-nums">{n}</span>
            <span className="text-xs text-pretty text-muted-foreground">{label}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The top of an app: what it is, how it's doing, and what you can do next. */
export function AppHero({ appId, name, url, lastRun, wallet, chainId, rollup, running, runs, action }: { appId: string; name: string; url: string; lastRun?: Date; wallet?: WalletProfileId; chainId?: number; rollup?: AppRollup; running: number; runs: RunSummary[]; action?: ReactNode }) {
  return (
    <header className="flex flex-col gap-8">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <h1 className="text-base font-semibold tracking-tight text-foreground">{name}</h1>
          <a href={url} target="_blank" rel="noreferrer" className="group/site inline-flex items-center gap-0.5 hover:text-foreground">
            {hostFromUrl(url)}
            <ArrowUpRight aria-hidden="true" className="size-3.5 opacity-60 transition-transform group-hover/site:translate-x-px group-hover/site:-translate-y-px" />
          </a>
          {wallet && <WalletIcon wallet={wallet} />}
          {chainId !== undefined && <ChainIcon chain={{ id: chainId }} />}
          {lastRun && (
            <Link href={`/apps/${appId}/runs`} className="hover:text-foreground">
              Last run {timeAgo(lastRun)}
            </Link>
          )}
        </div>
        {action}
      </div>
      {rollup && (
        <div className="grid items-center gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <p className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              <Verdict rollup={rollup} />
            </p>
            <Stats rollup={rollup} running={running} />
          </div>
          <RunHistory runs={runs} />
        </div>
      )}
    </header>
  );
}
