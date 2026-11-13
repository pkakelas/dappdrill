import { shortAddress, type WalletProfileId } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { ArrowUpRight, Check, CircleDashed, CircleQuestionMark, Mail, Play, Radio, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { ChainIcon, WalletIcon } from "@/components/web3-icons";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { Separator } from "@/components/ui/separator";
import { RunHistory } from "./app-stats";
import { IntroNote } from "./intro-note";
import { Tile, type TINT } from "./tile";

const DAY = 24 * 60 * 60 * 1000;

/** How the app's tests stand: each by its latest finished result. */
export interface Rollup {
  total: number;
  passed: number;
  failed: number;
  unverified: number;
  notRun: number;
}

/** How the tests are doing, worst first. A failed test is one the app got wrong. */
function Verdict({ rollup }: { rollup: Rollup }) {
  const { failed, unverified, passed, total } = rollup;
  const of = <span className="text-muted-foreground/70"> of {plural(total, "test")}</span>;
  if (failed > 0)
    return (
      <>
        <span className="text-bad">{failed} failed</span>
        {of}
      </>
    );
  if (unverified > 0)
    return (
      <>
        <span className="text-warn">{unverified} couldn&apos;t be verified</span>
        {of}
      </>
    );
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
function stats({ passed, failed, unverified, notRun, total }: Rollup, running: number) {
  const items: { icon: LucideIcon; tint: keyof typeof TINT; n: number; label: string }[] = [];
  if (running > 0) items.push({ icon: Play, tint: "live", n: running, label: "Running now" });
  // The headline names the worst; what comes after it gets a tile.
  if (failed > 0 && unverified > 0) items.push({ icon: CircleQuestionMark, tint: "warn", n: unverified, label: "Couldn't verify" });
  if (passed > 0 && passed < total) items.push({ icon: Check, tint: "good", n: passed, label: "Passed" });
  // When nothing has run, the headline already says so.
  if (notRun > 0 && notRun < total) items.push({ icon: CircleDashed, tint: "quiet", n: notRun, label: "Not run yet" });
  return items;
}

function Stats({ rollup, running }: { rollup: Rollup; running: number }) {
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

/** Where the app is and how it signs in: its site, wallet and chain. */
function Where({ url, wallet, chainId }: { url: string; wallet?: WalletProfileId; chainId?: number }) {
  return (
    <>
      <a href={url} target="_blank" rel="noreferrer" className="group/site inline-flex items-center gap-0.5 hover:text-foreground">
        {hostFromUrl(url)}
        <ArrowUpRight aria-hidden="true" className="size-3.5 opacity-60 transition-transform group-hover/site:translate-x-px group-hover/site:-translate-y-px" />
      </a>
      {wallet && <WalletIcon wallet={wallet} labelled />}
      {chainId !== undefined && <ChainIcon chain={{ id: chainId }} labelled />}
    </>
  );
}

/**
 * The top of the page while the app's first tests are made: what is happening, how long it takes and who
 * hears when it's done, and, on a chain that can't be forked, the account that pays.
 */
function MakingIntro({ appId, name, url, wallet, chainId, live, email }: { appId: string; name: string; url: string; wallet?: WalletProfileId; chainId?: number; live?: LiveChain; email?: string }) {
  return (
    <header className="flex flex-col items-center gap-8 pt-4 text-center sm:pt-8">
      <div className="flex flex-col items-center gap-2.5">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Writing tests for {name}</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Where url={url} wallet={wallet} chainId={chainId} />
        </div>
      </div>
      <div className="grid w-full max-w-2xl gap-3">
        <IntroNote id={`${appId}:wait`} icon={<Mail aria-hidden="true" />} tint="good" title="This takes up to an hour.">
          You can close this page.
          <br />
          {email ? (
            <>
              We&apos;ll email <span className="font-medium whitespace-nowrap">{email}</span> when the tests are ready.
            </>
          ) : (
            "Each test shows here as soon as it is proven."
          )}
        </IntroNote>
        {live && (
          <IntroNote id={`${appId}:live`} icon={<Radio aria-hidden="true" />} tint="live" title={`${live.name} can't be forked, so tests run on it for real.`}>
            {live.wallet ? (
              <>
                They pay from <span className="font-mono font-medium">{shortAddress(live.wallet.address)}</span>
                {live.wallet.balance && (
                  <>
                    , which holds <span className="font-medium whitespace-nowrap tabular-nums">{live.wallet.balance}</span>
                  </>
                )}
                .
                <br />
                Every run leaves real orders, positions and transactions on it.
              </>
            ) : (
              <>
                {live.funding ? "Each run signs in with a new account and gets test funds the way you described. " : "Each run needs an account with test funds there. "}
                <Link href={`/apps/${appId}/settings`} className="underline underline-offset-4">
                  {live.funding ? "Add a funded key" : "Add a funded key or say how to get test funds"}
                </Link>
                .
              </>
            )}
          </IntroNote>
        )}
      </div>
    </header>
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
  writing,
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
  /** The app's first tests are being made: the page is a waiting room, not a report. */
  writing?: { email?: string };
}) {
  if (writing) return <MakingIntro appId={appId} name={name} url={url} wallet={wallet} chainId={chainId} live={live} email={writing.email} />;
  // A chart of the last two weeks says nothing about an app that has only run today.
  const charted = new Set(runs.map((r) => Math.floor(r.createdAt.getTime() / DAY))).size > 1;
  return (
    <header className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Where url={url} wallet={wallet} chainId={chainId} />
            {lastRun && (
              <Link href={`/apps/${appId}/runs`} className="whitespace-nowrap hover:text-foreground">
                Last run {timeAgo(lastRun)}
              </Link>
            )}
          </div>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {live && <LiveNote appId={appId} live={live} />}
      {rollup && (
        <div className={cx("grid items-center gap-x-10 gap-y-8", charted && "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]")}>
          <div className="flex min-w-0 flex-col gap-6">
            <p className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              <Verdict rollup={rollup} />
            </p>
            <Stats rollup={rollup} running={running} />
          </div>
          {charted && <RunHistory runs={runs} />}
        </div>
      )}
    </header>
  );
}
