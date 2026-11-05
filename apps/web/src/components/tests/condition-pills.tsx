import { specOf, type TestRow, type TestRunRow } from "@dappdrill/db";
import Link from "next/link";
import { cx } from "@/components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RunButton } from "./run-button";
import { REVEAL, StateMark, type TestRead, type TestState } from "./status";

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
  const reason = (read.settled === "fail" || read.settled === "error" || read.settled === "skipped") && run?.result?.failure;
  if (!reason) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{failureParts(reason).why}</TooltipContent>
    </Tooltip>
  );
}
