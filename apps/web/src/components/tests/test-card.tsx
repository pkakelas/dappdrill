import { signingText, type SigningFlag as Signing } from "@dappdrill/core";
import { specOf, type TestRow, type TestRunRow } from "@dappdrill/db";
import { Bug, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/format";
import { failureParts, Line } from "./condition-branches";
import { RunButton } from "./run-button";
import { SigningFlag } from "./signing-flag";
import { OUR_ERROR, readLabel, REVEAL, STATE_LABEL, STATE_TEXT, StateMark, type TestRead } from "./status";
import { WriteTest } from "./write-test";

/** `run` is the result its status reads from; `live` the newest run, for progress. `signing` covers its conditions too. */
export interface TestCardProps {
  appId: string;
  test: TestRow;
  read: TestRead;
  run?: TestRunRow;
  live?: TestRunRow;
  signs: boolean;
  signing: Signing;
  hasConditions: boolean;
  /** The bug it found, and where that is listed. */
  found?: { name: string; href: string };
  /** What nests under the line: its conditions. */
  children?: ReactNode;
}

/** What's happening right now, while a run is on. */
function progress({ read, live }: TestCardProps): ReactNode {
  const steps = live?.result?.steps ?? [];
  const setup = live?.result?.setup?.steps ?? [];
  const current = steps.findIndex((s) => s.status === "running");
  const inSetup = setup.findIndex((s) => s.status === "running");
  if (read.drafting) return <span className="text-muted-foreground">Writing the steps…</span>;
  if (read.active === "running" && current >= 0) return <span className="text-live">Step {current + 1} of {steps.length}</span>;
  if (read.active === "running" && inSetup >= 0) return <span className="text-live">Setup, step {inSetup + 1} of {setup.length}</span>;
  if (read.active) return <span className="text-live">{STATE_LABEL[read.active]}</span>;
  return null;
}

/** Says the test signs. With no conditions yet it's also the way to add them, in words on hover. */
function WalletMark({ href }: { href?: string }) {
  const icon = <Wallet className="size-3.5 shrink-0" aria-hidden="true" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className="relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {icon}
            <span className={cx("max-sm:sr-only", REVEAL, "group-hover/line:opacity-100")}>Add conditions</span>
          </Link>
        ) : (
          <span role="img" aria-label="Asks the wallet to sign" className="relative z-10 shrink-0 text-muted-foreground">
            {icon}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>Asks the wallet to sign</TooltipContent>
    </Tooltip>
  );
}

function Title({ appId, test, signs, signing, hasConditions }: TestCardProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex-nowrap">
      <Link href={`/apps/${appId}/tests/${test.id}`} className="min-w-0 font-medium text-pretty outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
        {specOf(test).name}
      </Link>
      {signingText(signing) && <SigningFlag signing={signing} short />}
      {signs && <WalletMark href={hasConditions ? undefined : `/apps/${appId}/tests/${test.id}?add=conditions#conditions`} />}
    </div>
  );
}

/** The list the lines sit in, under its filter. */
export function TestList({ filter, children }: { filter: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      {filter}
      <ul className={cx("divide-y", filter && "border-t")}>{children}</ul>
    </div>
  );
}

/**
 * The line under the name: where it stopped, and whose move it is. A failure that isn't confirmed
 * says so; one whose test is at fault says what to change.
 */
function Under({ read, run, found }: Pick<TestCardProps, "read" | "run" | "found">) {
  if (read.ours) return <p className="truncate text-xs text-muted-foreground">{OUR_ERROR}</p>;
  const failure = run?.result?.failure;
  const look = run?.result?.secondLook;
  const at = failure ? failureParts(failure) : undefined;
  const where = at && (at.where ?? at.why);
  if (read.checking)
    return (
      <p className="flex items-center gap-2 text-xs text-live">
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50 motion-reduce:animate-none" />
          <span className="relative inline-flex size-1.5 rounded-full bg-live" />
        </span>
        <span className="truncate">Checking again in a fresh browser</span>
      </p>
    );
  if (read.settled === "fail" && found)
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-bad">
        <Bug className="size-3.5 shrink-0" aria-hidden="true" />
        <Link href={found.href} className="relative z-10 min-w-0 truncate rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {found.name}
        </Link>
      </p>
    );
  if (read.settled === "probable")
    return (
      <p className="truncate text-xs text-muted-foreground" title={look?.reason}>
        {where && <span className="text-bad">{where}</span>}
        {where && " · "}
        {look ? "Not confirmed when checked again" : "Not checked again yet"}
      </p>
    );
  if (read.settled === "input" && look?.verdict === "test") return <p className="truncate text-xs text-warn">The app is fine, the test was wrong{look.reason ? `: ${look.reason}` : "."}</p>;
  if ((read.settled === "fail" || read.settled === "input") && where) return <p className={cx("truncate text-xs", STATE_TEXT[read.settled])}>{where}</p>;
  return null;
}

/** A test as one line, with the bug it found named under it and its conditions nested below. One that stopped says where, which is what lifts it out of the list. */
export function TestLine(props: TestCardProps) {
  const { appId, test, read, run, children } = props;
  const now = progress(props);
  const reason = read.settled !== "pass" ? run?.result?.failure : undefined;
  return (
    <li className="p-1.5">
      <Line
        className="min-h-11 py-2"
        mark={<StateMark state={read.mark} size="lg" />}
        name={
          <div className="flex min-w-0 flex-col gap-0.5">
            <Title {...props} />
            <Under read={read} run={run} found={props.found} />
          </div>
        }
        status={
          <span title={reason}>
            {now ?? <span className={STATE_TEXT[read.mark]}>{readLabel(read)}</span>}
            {!now && run?.finishedAt && ` · ${timeAgo(run.finishedAt)}`}
          </span>
        }
        action={<RunButton target={{ appId, testIds: [test.id] }} active={Boolean(read.active)} stopIds={[test.id]} label="Run test" disabled={read.drafting} />}
      />
      {children}
    </li>
  );
}

/** A test with a name and a goal but no steps yet. */
export function DraftLine({ appId, test }: { appId: string; test: TestRow }) {
  return (
    <li className="p-1.5">
      <Line
        className="min-h-11 py-2"
        mark={<StateMark state="never" size="lg" />}
        name={
          <Link href={`/apps/${appId}/tests/${test.id}`} className="min-w-0 font-medium text-pretty outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
            {test.name}
          </Link>
        }
        status="Not tested yet"
        action={<WriteTest testId={test.id} />}
      />
    </li>
  );
}
