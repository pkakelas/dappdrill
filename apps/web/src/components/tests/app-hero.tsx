import { shortAddress, type AppRollup, type WalletProfileId } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { ArrowUpRight, Check, CircleDashed, CircleQuestionMark, GitFork, Mail, PenLine, Play, Radio, ScanSearch, type LucideIcon } from "lucide-react";
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

/** How the tests are doing, worst first. A failed test is one the app got wrong. */
function Verdict({ rollup }: { rollup: AppRollup }) {
  const { failed, probable, needsInput, passed, total } = rollup.tests;
  const of = <span className="text-muted-foreground/70"> of {plural(total, "test")}</span>;
  if (failed > 0)
    return (
      <>
        <span className="text-bad">{failed} failed</span>
        {of}
      </>
    );
  if (probable > 0)
    return (
      <>
        <span className="text-bad">{probable} probably failed</span>
        {of}
      </>
    );
  if (needsInput > 0)
    return (
      <>
        <span className="text-warn">
          {needsInput} {needsInput === 1 ? "needs" : "need"} your input
        </span>
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

/** What the checks came to: how many were made, and how many of them found a bug. */
function Checked({ appId, checks, bugs }: { appId: string; checks: number; bugs: number }) {
  const from = <span className="text-muted-foreground/70"> from {plural(checks, "check")}</span>;
  if (bugs === 0)
    return (
      <>
        <span className="text-good">No bugs</span>
        {from}
      </>
    );
  return (
    <>
      <Link href={`/apps/${appId}?tab=bugs`} scroll={false} className="rounded-sm text-bad outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        {plural(bugs, "bug")}
      </Link>
      {checks > 0 && from}
    </>
  );
}

/** The counts behind the headline, each with its own tile. */
function stats({ tests, conditionsFailed, signing, untested }: AppRollup, running: number) {
  const { passed, failed, probable, needsInput, notRun, total } = tests;
  // When nothing has run, the headline already says so.
  const waiting = notRun < total ? notRun + untested : 0;
  const items: { icon: LucideIcon; tint: keyof typeof TINT; n: number; label: string }[] = [];
  if (running > 0) items.push({ icon: Play, tint: "live", n: running, label: "Running now" });
  if (signing.dangerous > 0) items.push({ icon: PenLine, tint: "bad", n: signing.dangerous, label: signing.dangerous === 1 ? "Dangerous signature" : "Dangerous signatures" });
  // The headline names the worst; what comes after it gets a tile.
  if (failed > 0 && probable > 0) items.push({ icon: ScanSearch, tint: "bad", n: probable, label: "Probably failed" });
  if (failed + probable > 0 && needsInput > 0) items.push({ icon: CircleQuestionMark, tint: "warn", n: needsInput, label: needsInput === 1 ? "Needs your input" : "Need your input" });
  if (failed + probable + needsInput > 0 && conditionsFailed > 0) items.push({ icon: GitFork, tint: "fork", n: conditionsFailed, label: conditionsFailed === 1 ? "Condition failed" : "Conditions failed" });
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

/**
 * The top of an app: what it is, how it's doing, and what you can do next. The headline is the two
 * things exploring gives: how the tests did, and what the checks found (`checked`).
 */
/** The chain tests run on for real, when they don't run on a fork, and the account that pays there. */
export interface LiveChain {
  name: string;
  /** The funded wallet, when the app has one, with what it holds ("0.42 ETH") when the chain answered. */
  wallet?: { address: string; balance?: string };
  /** The latest runs signed with the app's own embedded wallet, not ours, so the funded wallet's balance isn't what they spend. */
  embeddedSigner?: boolean;
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
            {live.embeddedSigner && <> Tests sign with the app&apos;s own wallet, so this balance isn&apos;t what they spend.</>}
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
      {wallet && <WalletIcon wallet={wallet} />}
      {chainId !== undefined && <ChainIcon chain={{ id: chainId }} />}
    </>
  );
}

/**
 * The top of the page while a pass writes the tests: what is happening, how long it takes and who
 * hears when it's done, and, on a chain that can't be forked, the account that pays.
 */
function PassIntro({ appId, name, url, wallet, chainId, live, email }: { appId: string; name: string; url: string; wallet?: WalletProfileId; chainId?: number; live?: LiveChain; email?: string }) {
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
            "The tests show here as each one passes."
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
                {live.embeddedSigner ? "Tests sign with the app's own wallet, so this balance isn't what they spend." : "Every run leaves real orders, positions and transactions on it."}
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

export function AppHero({ appId, name, url, lastRun, wallet, chainId, live, rollup, checked, running, runs, action, writing }: { appId: string; name: string; url: string; lastRun?: Date; wallet?: WalletProfileId; chainId?: number; live?: LiveChain; rollup?: AppRollup; checked?: { checks: number; bugs: number }; running: number; runs: RunSummary[]; action?: ReactNode; writing?: { email?: string } }) {
  if (writing) return <PassIntro appId={appId} name={name} url={url} wallet={wallet} chainId={chainId} live={live} email={writing.email} />;
  const both = Boolean(rollup && rollup.tests.total > 0 && checked);
  // A chart of the last two weeks says nothing about an app that has only run today.
  const charted = new Set(runs.map((r) => Math.floor(r.createdAt.getTime() / DAY))).size > 1;
  return (
    <header className="flex flex-col gap-8">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <h1 className="text-base font-semibold tracking-tight text-foreground">{name}</h1>
          <Where url={url} wallet={wallet} chainId={chainId} />
          {lastRun && (
            <Link href={`/apps/${appId}/runs`} className="hover:text-foreground">
              Last run {timeAgo(lastRun)}
            </Link>
          )}
        </div>
        {action}
      </div>
      {live && <LiveNote appId={appId} live={live} />}
      {rollup && (
        <div className={cx("grid items-center gap-x-10 gap-y-8", charted && "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]")}>
          <div className="flex min-w-0 flex-col gap-6">
            <p className={cx("flex flex-col gap-1 font-semibold tracking-tight text-balance", both ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl")}>
              {rollup.tests.total > 0 && (
                <span>
                  <Verdict rollup={rollup} />
                </span>
              )}
              {checked && (
                <span>
                  <Checked appId={appId} {...checked} />
                </span>
              )}
            </p>
            <Stats rollup={rollup} running={running} />
          </div>
          {charted && <RunHistory runs={runs} />}
        </div>
      )}
    </header>
  );
}
