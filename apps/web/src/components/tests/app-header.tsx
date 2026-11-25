import { chainName, shortAddress, type WalletProfileId } from "@dappdrill/core";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { ChainIcon, WALLET_NAME, WalletIcon } from "@/components/web3-icons";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { AppIcon } from "./app-icon";
import { LiveDot } from "./status";

/** How many chain icons the header shows side by side; the count beside them says the rest. */
const CHAIN_ICONS = 4;

/** The account with a key of its own that the tests use, or that pays for each new one. */
export interface TestAccount {
  kept: boolean;
  address: string;
  /** What it holds on the app's first chain ("0.42 ETH"), when the chain answered. */
  balance?: string;
}

/** How many of the app's tests stand each way. Every test is counted once. */
export interface Standing {
  bugs: number;
  failed: number;
  unverified: number;
  repair: number;
  passed: number;
  notRun: number;
  running: number;
}

/** One part of how the tests stand: a dot in its colour, the count and what it counts. */
function Part({ dot, tone, children }: { dot: ReactNode; tone?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-2 whitespace-nowrap", tone)}>
      {typeof dot === "string" ? <span aria-hidden="true" className={cx("size-2 rounded-full", dot)} /> : dot}
      {children}
    </span>
  );
}

/** How the tests stand in one line, what needs attention first. */
function StandingLine({ appId, standing: s, lastRun }: { appId: string; standing: Standing; lastRun?: Date }) {
  const total = s.bugs + s.failed + s.unverified + s.repair + s.passed + s.notRun;
  const allPass = s.passed === total;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t pt-4 text-sm">
      <p aria-label="How the tests stand" className="flex flex-wrap items-center gap-x-5 gap-y-2 font-medium">
        {s.bugs > 0 && (
          <Part dot="bg-bad-mid" tone="text-bad">
            {plural(s.bugs, "bug")} found
          </Part>
        )}
        {s.failed > 0 && (
          <Part dot="bg-bad-mid" tone="text-bad">
            {s.failed} failed
          </Part>
        )}
        {s.repair > 0 && (
          <Part dot="bg-warn-bar" tone="text-warn">
            {s.repair} {s.repair === 1 ? "needs" : "need"} repair
          </Part>
        )}
        {s.unverified > 0 && (
          <Part dot="bg-warn-bar" tone="text-warn">
            {s.unverified} couldn&apos;t verify
          </Part>
        )}
        {s.passed > 0 && <Part dot="bg-good-bar">{allPass ? `All ${plural(total, "test")} passed` : `${s.passed} passed`}</Part>}
        {s.notRun > 0 && (
          <Part dot="bg-foreground/20" tone="text-muted-foreground">
            {s.notRun} not run yet
          </Part>
        )}
        {s.running > 0 && (
          <Part dot={<LiveDot />} tone="text-live">
            {s.running} running
          </Part>
        )}
      </p>
      {lastRun && (
        <Link href={`/apps/${appId}/runs`} className="text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-4">
          Last run {timeAgo(lastRun)}
        </Link>
      )}
    </div>
  );
}

const DOT = <span aria-hidden="true">·</span>;

/** The top of an app: what it is and where it runs in one line, the one thing to do, and how its tests stand. */
export function AppHeader({
  appId,
  name,
  url,
  wallet,
  chains,
  chainUnseen,
  account,
  standing,
  lastRun,
  action,
}: {
  appId: string;
  name: string;
  url: string;
  wallet?: WalletProfileId;
  /** The chains the owner named or the app was seen to use, the first being the one the wallet starts on. */
  chains: number[];
  /** The app was explored and asked the wallet for no chain, so nothing is known yet. */
  chainUnseen?: boolean;
  account?: TestAccount;
  /** Unset while there are no tests to count. */
  standing?: Standing;
  lastRun?: Date;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AppIcon appId={appId} name={name} className="size-12 rounded-xl" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
                {hostFromUrl(url)}
                <ArrowUpRight aria-hidden="true" className="size-3.5 opacity-60" />
              </a>
              {wallet && (
                <>
                  {DOT}
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <WalletIcon wallet={wallet} className="size-4" />
                    {WALLET_NAME[wallet]}
                  </span>
                </>
              )}
              {chains.length > 0 && (
                <>
                  {DOT}
                  <span title={chains.length > 1 ? chains.map(chainName).join(", ") : undefined} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="flex gap-1">
                      {chains.slice(0, CHAIN_ICONS).map((id) => (
                        <ChainIcon key={id} chain={{ id }} className="size-4 rounded-full" />
                      ))}
                    </span>
                    {chains.length === 1 ? chainName(chains[0]!) : plural(chains.length, "chain")}
                  </span>
                </>
              )}
              {chainUnseen && (
                <>
                  {DOT}
                  <Link
                    href={`/apps/${appId}/settings#chains`}
                    title="Your app hasn't asked the wallet for a chain yet, so the wallet starts on Ethereum. We add each chain as the app asks for it, or you can name them in Settings."
                    className="whitespace-nowrap hover:text-foreground hover:underline hover:underline-offset-4"
                  >
                    No chain seen yet
                  </Link>
                </>
              )}
              {account && (
                <>
                  {DOT}
                  <Link
                    href={`/apps/${appId}/settings#account`}
                    title={account.kept ? "The account every test signs with" : "The account that pays each test's new account"}
                    className="whitespace-nowrap hover:text-foreground hover:underline hover:underline-offset-4"
                  >
                    {account.kept ? "Account" : "Paid from"} <span className="font-mono text-[13px]">{shortAddress(account.address)}</span>
                    {account.balance && <span className="tabular-nums">, {account.balance}</span>}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {standing && <StandingLine appId={appId} standing={standing} lastRun={lastRun} />}
    </header>
  );
}
