import { specOf, type TestRow, type TestRunRow } from "@dappdrill/db";
import Link from "next/link";
import { cx } from "@/components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RunButton } from "./run-button";
import { readLabel, REVEAL, STATE_TEXT, StateMark, type TestRead, type TestState } from "./status";

/** "Step 1, “Connect the wallet”: why" as the step and the why, so only the step needs colour. */
export function failureParts(failure: string) {
  const m = /^Step (\d+), “(.+?)”: (.*)$/s.exec(failure);
  return m ? { where: `Step ${m[1]}: ${m[2]}`, why: m[3]! } : { where: null, why: failure };
}

/** A test's conditions, as a line of pills. Only the ones with a problem get colour. */
export function ConditionPills({
  appId,
  tests,
  reads,
  runs,
  className,
  children,
}: {
  appId: string;
  tests: TestRow[];
  reads: Map<string, TestRead>;
  /** Latest finished result of each condition, for the reason on hover. */
  runs: Map<string, TestRunRow>;
  className?: string;
  children?: React.ReactNode;
}) {
  const active = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
  return (
    <div role="group" aria-label="Conditions" className={cx("group/paths flex flex-wrap items-center gap-1.5", className)}>
      {tests.map((t) => (
        <ConditionPill key={t.id} appId={appId} test={t} read={reads.get(t.id)!} run={runs.get(t.id)} />
      ))}
      {children}
      {tests.length > 0 && (
        <span className={cx(active.length === 0 && REVEAL, "group-hover/paths:opacity-100")}>
          <RunButton target={{ appId, testIds: tests.map((t) => t.id) }} active={active.length > 0} stopIds={active} label="Run conditions" />
        </span>
      )}
    </div>
  );
}

/** One line of the test list: its name and one status on the right. Pointing at the line swaps the status for its action. */
export function Line({ mark, name, status, action, className }: { mark: React.ReactNode; name: React.ReactNode; status: React.ReactNode; action: React.ReactNode; className?: string }) {
  return (
    <div className={cx("group/line relative flex items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-foreground/5", className)}>
      {mark}
      <div className="flex min-w-0 flex-1 flex-col gap-x-4 sm:flex-row sm:items-center sm:justify-between">
        {name}
        <span className="shrink-0 text-xs text-muted-foreground sm:group-hover/line:invisible sm:group-has-[button:focus-visible]/line:invisible">{status}</span>
      </div>
      <span className={cx("relative z-10 flex items-center [@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-2", REVEAL, "group-hover/line:opacity-100")}>{action}</span>
    </div>
  );
}

/** A test's conditions, nested under its line: the same steps, each with one thing going wrong. */
export function ConditionBranches({ appId, tests, reads, runs, className }: { appId: string; tests: TestRow[]; reads: Map<string, TestRead>; runs: Map<string, TestRunRow>; className?: string }) {
  return (
    <ul aria-label="Conditions" className={cx("ml-4", className)}>
      {tests.map((t) => (
        <li
          key={t.id}
          className="relative pl-2.5 before:absolute before:top-0 before:left-0 before:h-1/2 before:w-2.5 before:rounded-bl-md before:border-b before:border-l before:border-foreground/20 after:absolute after:top-0 after:bottom-0 after:left-0 after:border-l after:border-foreground/20 first:before:-top-3 first:before:h-[calc(50%+0.75rem)] first:after:-top-3 last:after:hidden"
        >
          <Branch appId={appId} test={t} read={reads.get(t.id)!} run={runs.get(t.id)} />
        </li>
      ))}
    </ul>
  );
}

function Branch({ appId, test, read, run }: { appId: string; test: TestRow; read: TestRead; run?: TestRunRow }) {
  const quiet = read.mark === "pass" && !read.active;
  const line = (
    <Line
      className="min-h-9"
      mark={<StateMark state={read.mark} />}
      name={
        <Link href={`/apps/${appId}/tests/${test.id}`} className="min-w-0 truncate text-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
          {specOf(test).name}
        </Link>
      }
      status={!quiet && <span className={read.active ? "text-live" : STATE_TEXT[read.mark]}>{readLabel(read)}</span>}
      action={<RunButton target={{ appId, testIds: [test.id] }} active={Boolean(read.active)} stopIds={[test.id]} label="Run condition" />}
    />
  );
  return <WithReason read={read} run={run}>{line}</WithReason>;
}

/** Why it didn't pass, on hover. */
function WithReason({ read, run, children }: { read: TestRead; run?: TestRunRow; children: React.ReactElement }) {
  const reason = (read.settled === "fail" || read.settled === "error" || read.settled === "skipped") && run?.result?.failure;
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{failureParts(reason).why}</TooltipContent>
    </Tooltip>
  );
}

const PILL: Partial<Record<TestState, string>> = {
  fail: "bg-bad-bg text-bad-ink hover:bg-bad-soft",
  error: "bg-warn-bg text-warn hover:bg-warn-bg/70",
  running: "bg-live-bg text-live-ink",
  queued: "bg-live-bg text-live-ink",
};

function ConditionPill({ appId, test, read, run }: { appId: string; test: TestRow; read: TestRead; run?: TestRunRow }) {
  const pill = (
    <Link
      href={`/apps/${appId}/tests/${test.id}`}
      className={cx(
        "inline-flex h-7 max-w-full items-center gap-1 rounded-full pr-3 pl-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        PILL[read.mark] ?? "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <StateMark state={read.mark} />
      <span className="truncate">{specOf(test).name}</span>
      {read.active && read.settled !== "never" && <StateMark state={read.active} className="size-3" />}
    </Link>
  );
  return <WithReason read={read} run={run}>{pill}</WithReason>;
}
