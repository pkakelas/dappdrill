import { chainName, shortAddress, type WalletProfileId } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { ArrowUpRight, Radio } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { ChainIcon, WALLET_NAME, WalletIcon } from "@/components/web3-icons";
import { hostFromUrl, timeAgo } from "@/lib/format";
import { Separator } from "@/components/ui/separator";
import { AppIcon } from "./app-icon";
import { RunHistory } from "./app-stats";
import { Tile } from "./tile";

const DAY = 24 * 60 * 60 * 1000;

/** How the app's tests stand: each by its latest finished result. */
export interface Rollup {
  total: number;
  passed: number;
  failed: number;
  unverified: number;
  notRun: number;
}

/** The share of tests in each result, failures first from the top; what hasn't run is the empty track. */
function Ring({ rollup }: { rollup: Rollup }) {
  const r = 18;
  const around = 2 * Math.PI * r;
  const parts = [
    { n: rollup.failed, stroke: "stroke-bad-mid" },
    { n: rollup.unverified, stroke: "stroke-warn-bar" },
    { n: rollup.passed, stroke: "stroke-good-bar" },
  ].filter((p) => p.n > 0);
  const gap = parts.length > 1 ? 2 : 0;
  let at = 0;
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true" className="size-11 shrink-0 -rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" className="stroke-foreground/8" />
      {parts.map(({ n, stroke }) => {
        const length = (n / rollup.total) * around;
        const arc = <circle key={stroke} cx="22" cy="22" r={r} fill="none" strokeWidth="5" className={stroke} strokeDasharray={`${Math.max(0, length - gap)} ${around}`} strokeDashoffset={-at} />;
        at += length;
        return arc;
      })}
    </svg>
  );
}

function LiveDot() {
  return (
    <span aria-hidden="true" className="relative flex size-1.5">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-1.5 rounded-full bg-live" />
    </span>
  );
}

/** One figure in the row: a small label over its value. */
function Figure({ label, dot, tone, children }: { label: string; dot?: ReactNode; tone?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
        {typeof dot === "string" ? <span aria-hidden="true" className={cx("size-1.5 rounded-full", dot)} /> : dot}
        {label}
      </span>
      <span className={cx("flex h-8 items-center text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums", tone)}>{children}</span>
    </div>
  );
}

/** How the tests stand, in a row of figures: the share passing, each result's count, the last run and the last two weeks. */
function Figures({ appId, rollup, running, lastRun, history }: { appId: string; rollup: Rollup; running: number; lastRun?: Date; history?: ReactNode }) {
  const { total, passed, failed, unverified, notRun } = rollup;
  return (
    <section aria-label="How the tests stand" className="flex flex-wrap items-end gap-x-12 gap-y-6 border-y py-6">
      <div className="flex items-end gap-4">
        <Ring rollup={rollup} />
        <Figure label="Passing">{notRun === total ? "–" : `${Math.round((passed / total) * 100)}%`}</Figure>
      </div>
      <Figure label="Failed" dot="bg-bad-mid" tone={failed > 0 ? "text-bad" : undefined}>
        {failed}
      </Figure>
      {unverified > 0 && (
        <Figure label="Couldn't verify" dot="bg-warn-bar" tone="text-warn">
          {unverified}
        </Figure>
      )}
      <Figure label="Passed" dot="bg-good-bar">
        {passed}
      </Figure>
      {notRun > 0 && (
        <Figure label="Not run yet" dot="bg-foreground/20">
          {notRun}
        </Figure>
      )}
      {running > 0 && (
        <Figure label="Running now" dot={<LiveDot />} tone="text-live">
          {running}
        </Figure>
      )}
      {lastRun && (
        <Figure label="Last run">
          <Link href={`/apps/${appId}/runs`} className="hover:underline hover:underline-offset-4">
            {timeAgo(lastRun)}
          </Link>
        </Figure>
      )}
      {history && <div className="sm:ml-auto">{history}</div>}
    </section>
  );
}

/** The chain tests run on for real, when they don't run on a fork, and the account that pays there. */
export interface LiveChain {
  name: string;
  /** The funded wallet, when the app has one, with what it holds ("0.42 ETH") when the chain answered. */
  wallet?: { address: string; balance?: string };
  /** The owner said how a new account gets test funds, which is what runs do without a funded wallet. */
  funding?: boolean;
}

/** Where tests run for real, and the account that pays there: the figures first, then what that means. */
function LiveNote({ appId, live }: { appId: string; live: LiveChain }) {
  const facts: { value: ReactNode; label: string }[] = [{ value: live.name, label: "Live chain, can't be forked" }];
  if (live.wallet) facts.push({ value: <span className="font-mono">{shortAddress(live.wallet.address)}</span>, label: "Funded wallet" });
  if (live.wallet?.balance) facts.push({ value: <span className="tabular-nums">{live.wallet.balance}</span>, label: "In the wallet" });
  return (
    <div className="-mt-3 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Tile icon={Radio} tint="live" />
        {facts.map(({ value, label }, i) => (
          <div key={label} className="flex items-center gap-5">
            {i > 0 && <Separator orientation="vertical" className="data-[orientation=vertical]:h-8" />}
            <p className="flex flex-col">
              <span className="text-sm leading-tight font-medium">{value}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        {live.wallet ? (
          <>
            Every run leaves real orders, positions and transactions on this account.
          </>
        ) : (
          <>
            {live.funding ? "Each run signs in with a new account and gets test funds the way you described;" : "Each run needs an account with test funds there;"}{" "}
            <Link href={`/apps/${appId}/settings`} className="underline underline-offset-4 hover:text-foreground">
              add a funded key
            </Link>{" "}
            {live.funding ? "to run everything from one account instead." : "or say how to get test funds."}
          </>
        )}
      </p>
    </div>
  );
}

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium whitespace-nowrap text-foreground/80";

/** Where the app is and how it signs in: its site, then its wallet and chain as chips, each a logo and its name. */
function Where({ url, wallet, chainId }: { url: string; wallet?: WalletProfileId; chainId?: number }) {
  return (
    <>
      <a href={url} target="_blank" rel="noreferrer" className="group/site mr-1 inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
        {hostFromUrl(url)}
        <ArrowUpRight aria-hidden="true" className="size-3.5 opacity-60 transition-transform group-hover/site:translate-x-px group-hover/site:-translate-y-px" />
      </a>
      {wallet && (
        <span className={CHIP}>
          <WalletIcon wallet={wallet} className="-ml-1 size-4" />
          {WALLET_NAME[wallet]}
        </span>
      )}
      {chainId !== undefined && (
        <span className={CHIP}>
          <ChainIcon chain={{ id: chainId }} className="-ml-1 size-4 rounded-full" />
          {chainName(chainId)}
        </span>
      )}
    </>
  );
}

/** The top of an app: what it is, how its tests stand, and what you can do next. */
export function AppHero({
  appId,
  name,
  url,
  lastRun,
  wallet,
  chainId,
  live,
  rollup,
  running,
  runs,
  action,
}: {
  appId: string;
  name: string;
  url: string;
  lastRun?: Date;
  wallet?: WalletProfileId;
  chainId?: number;
  live?: LiveChain;
  /** Unset while there are no tests to count. */
  rollup?: Rollup;
  running: number;
  runs: RunSummary[];
  action?: ReactNode;
}) {
  // A chart of the last two weeks says nothing about an app that has only run today.
  const charted = new Set(runs.map((r) => Math.floor(r.createdAt.getTime() / DAY))).size > 1;
  return (
    <header className="flex flex-col gap-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
          <AppIcon appId={appId} name={name} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{name}</h1>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Where url={url} wallet={wallet} chainId={chainId} />
            </div>
          </div>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {live && <LiveNote appId={appId} live={live} />}
      {rollup && <Figures appId={appId} rollup={rollup} running={running} lastRun={lastRun} history={charted && <RunHistory runs={runs} />} />}
    </header>
  );
}
