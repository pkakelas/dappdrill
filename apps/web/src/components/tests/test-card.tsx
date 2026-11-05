import { signingText, type SigningFlag as Signing, type StepStatus } from "@dappdrill/core";
import { specOf, type TestRow, type TestRunRow } from "@dappdrill/db";
import { Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { artifactUrl } from "@/lib/artifacts";
import { plural, timeAgo } from "@/lib/format";
import { failureParts, Line } from "./condition-pills";
import { RunButton } from "./run-button";
import { SigningFlag } from "./signing-flag";
import { readLabel, REVEAL, STATE_LABEL, STATE_TEXT, StateMark, type TestRead } from "./status";
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
  /** The test's conditions. */
  children?: ReactNode;
}

const SEGMENT: Record<StepStatus, string> = {
  pass: "bg-foreground/25",
  fail: "bg-bad",
  running: "animate-pulse bg-live",
  pending: "bg-foreground/10",
  skipped: "bg-foreground/10",
};

/** A test's steps as one bar, so where it stopped shows without reading anything. */
function StepTrail({ steps, stuck }: { steps: StepStatus[]; stuck?: boolean }) {
  const passed = steps.filter((s) => s === "pass").length;
  const label = `${passed} of ${plural(steps.length, "step")} passed`;
  if (steps.length === 0) return null;
  return (
    <div className="flex items-center gap-3">
      <div role="img" aria-label={label} title={label} className="flex h-1.5 min-w-0 flex-1 gap-0.5">
        {steps.map((s, i) => (
          <span key={i} className={cx("min-w-0 flex-1 rounded-full", s === "fail" && stuck ? "bg-warn-bar" : SEGMENT[s])} />
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {passed > 0 && passed < steps.length ? `${passed} of ${steps.length}` : plural(steps.length, "step")}
      </span>
    </div>
  );
}

/** The steps as the bar draws them: the run in progress, else the last result, else steps that haven't run. */
function trailOf({ test, read, run, live }: TestCardProps): StepStatus[] {
  const steps = (read.active ? live?.result?.steps : undefined) ?? run?.result?.steps;
  return steps?.length ? steps.map((s) => s.status) : test.steps.map(() => "pending");
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
            <span className={cx("max-sm:sr-only", REVEAL, "group-hover/test:opacity-100")}>Add conditions</span>
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

function Title({ appId, test, signs, signing, hasConditions, className }: TestCardProps & { className?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Link href={`/apps/${appId}/tests/${test.id}`} className={cx("min-w-0 font-medium text-pretty outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline", className)}>
        {specOf(test).name}
      </Link>
      {signingText(signing) && <SigningFlag signing={signing} short />}
      {signs && <WalletMark href={hasConditions ? undefined : `/apps/${appId}/tests/${test.id}?add=conditions#conditions`} />}
    </div>
  );
}

/** The status mark, with the test beside it. A test with conditions grows a trunk from the mark for them to branch off. */
function Trunk({ mark, forked, className, children }: { mark: TestRead["mark"]; forked: boolean; className?: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="flex w-4 shrink-0 flex-col">
        <StateMark state={mark} className="mt-0.5" />
        {forked && <span className="mt-1 ml-2 w-px flex-1 bg-foreground/20" />}
      </div>
      <div className={cx("flex min-w-0 flex-1 flex-col", className)}>{children}</div>
    </div>
  );
}

/** The list the lines sit in. */
export function TestList({ children }: { children: ReactNode }) {
  return <ul className="divide-y rounded-xl border bg-card shadow-xs">{children}</ul>;
}

/** A test that ran to the end, or hasn't run, as one line. Its conditions nest under it. */
export function TestLine(props: TestCardProps) {
  const { appId, test, read, run, children } = props;
  const now = progress(props);
  const reason = read.settled === "skipped" ? run?.result?.failure : undefined;
  return (
    <li className="p-1.5">
      <Line
        className="min-h-10 py-1.5"
        mark={<StateMark state={read.mark} />}
        name={<Title {...props} />}
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

/** A test that failed or couldn't run: where it stopped, why, and what the page looked like at that moment. */
export function ProblemCard(props: TestCardProps) {
  const { appId, test, read, run, children } = props;
  const stuck = read.settled === "error";
  const failure = run?.result?.failure ? failureParts(run.result.failure) : undefined;
  const shot = run && artifactUrl("runs", run.batchId, run.result?.steps.findLast((s) => s.screenshot)?.screenshot);
  const now = progress(props);
  return (
    <Card className={cx("group/test relative gap-0 overflow-hidden py-0 shadow-xs sm:flex-row", stuck ? "border-warn-line bg-warn-soft" : "border-bad-line bg-bad-soft")}>
      <div className="flex min-w-0 flex-1 flex-col p-5">
        <Trunk mark={read.mark} forked={Boolean(children)} className="gap-3">
          <div className="flex items-start gap-2.5">
            <Title {...props} className="text-base font-semibold tracking-tight" />
            <span className="relative z-10 -my-1 shrink-0">
              <RunButton target={{ appId, testIds: [test.id] }} active={Boolean(read.active)} stopIds={[test.id]} label="Run again" size="sm" disabled={read.drafting} />
            </span>
          </div>
          {failure && (
            <div className="flex flex-col gap-1" title={run?.result?.failure}>
              <p className={cx("font-medium text-pretty", stuck ? "text-warn" : "text-bad")}>{failure.where ?? STATE_LABEL[read.settled]}</p>
              <p className="line-clamp-3 text-pretty text-foreground/70">{failure.why}</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <StepTrail steps={trailOf(props)} stuck={stuck} />
            {(now || run?.finishedAt) && <p className="text-xs text-muted-foreground">{now ?? `${readLabel(read)} ${timeAgo(run!.finishedAt!)}`}</p>}
          </div>
        </Trunk>
        {children && <div className="-ml-2">{children}</div>}
      </div>
      {shot && (
        <div className="shrink-0 border-t border-inherit sm:w-80 sm:border-t-0 sm:border-l">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt={`The page when ${specOf(test).name} stopped`} className="h-48 w-full object-cover object-top sm:h-full sm:min-h-52" />
        </div>
      )}
    </Card>
  );
}

/** A test with a name and a goal but no steps yet. */
export function DraftLine({ appId, test }: { appId: string; test: TestRow }) {
  return (
    <li className="p-1.5">
      <Line
        className="min-h-10 py-1.5"
        mark={<StateMark state="never" />}
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
