import { chainName, shortAddress, type WalletProfileId } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { ArrowUpRight, UserRound, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { ChainIcon, WALLET_NAME, WalletIcon } from "@/components/web3-icons";
import { DAY, hostFromUrl, timeAgo } from "@/lib/format";
import { Separator } from "@/components/ui/separator";
import { AppIcon } from "./app-icon";
import { RunHistory } from "./app-stats";
import { LiveDot } from "./status";
import { Tile } from "./tile";

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
        <Figure label="Running now" dot={<LiveDot small />} tone="text-live">
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

/** The account with a key of its own that the tests use, or that pays for each new one. */
export interface TestAccount {
  kept: boolean;
  address: string;
  /** The app's first chain, and what the account holds there ("0.42 ETH") when the chain answered. */
  chain?: string;
  balance?: string;
}

/** The account that pays on the chain: the figures first, then what that means. */
function AccountNote({ appId, account }: { appId: string; account: TestAccount }) {
  const facts: { value: ReactNode; label: string }[] = [
    { value: account.kept ? "Kept account" : "New account for every test", label: "Account" },
    { value: <span className="font-mono">{shortAddress(account.address)}</span>, label: account.kept ? "Signs every test" : "Pays each new account" },
  ];
  if (account.balance) facts.push({ value: <span className="tabular-nums">{account.balance}</span>, label: account.chain ? `Holds on ${account.chain}` : "Holds" });
  return (
    <div className="-mt-3 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Tile icon={account.kept ? UserRound : UserRoundPlus} tint="violet" />
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
        {account.kept ? "Every run leaves its orders, positions and transactions on this account." : "Each test's account is sent its funds from this one before the setup."}{" "}
        <Link href={`/apps/${appId}/settings#account`} className="underline underline-offset-4 hover:text-foreground">
          Change the account
        </Link>
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
  account,
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
  account?: TestAccount;
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
      {account && <AccountNote appId={appId} account={account} />}
      {rollup && <Figures appId={appId} rollup={rollup} running={running} lastRun={lastRun} history={charted && <RunHistory runs={runs} />} />}
    </header>
  );
}
