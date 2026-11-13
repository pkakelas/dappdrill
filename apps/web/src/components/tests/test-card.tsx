import type { TestRow, TestRunRow } from "@dappdrill/db";
import { Bug } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { RunButton } from "./run-button";
import { readLabel, REVEAL, STATE_TEXT, StateMark, type TestRead } from "./status";
import { shortSigned } from "./signed";

/** One line of a list: its name and one status on the right. Pointing at the line swaps the status for its action. */
export function Line({ mark, name, status, action, className }: { mark: ReactNode; name: ReactNode; status: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("group/line relative flex items-center gap-3 rounded-lg px-2 transition-colors hover:bg-foreground/5", className)}>
      {mark}
      <div className="flex min-w-0 flex-1 flex-col gap-x-4 sm:flex-row sm:items-center sm:justify-between">
        {name}
        <span className={cx("shrink-0 text-xs text-muted-foreground", Boolean(action) && "sm:group-hover/line:invisible sm:group-has-[button:focus-visible]/line:invisible")}>{status}</span>
      </div>
      {Boolean(action) && <span className={cx("relative z-10 flex items-center [@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-2", REVEAL, "group-hover/line:opacity-100")}>{action}</span>}
    </div>
  );
}

/** The list the lines sit in. */
export function TestList({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <ul className="divide-y">{children}</ul>
    </div>
  );
}

/** `run` is the result its status reads from; `live` the newest run, for progress. */
export interface TestLineProps {
  appId: string;
  test: TestRow;
  read: TestRead;
  run?: TestRunRow;
  live?: TestRunRow;
  /** Kept by the make that is running now. */
  fresh?: boolean;
}

/** What's happening right now, while a run is on. */
function progress({ read, live }: TestLineProps): ReactNode {
  if (!read.active) return null;
  const steps = live?.result?.steps ?? [];
  const done = steps.filter((s) => s.status !== "skipped").length;
  if (read.active === "running" && steps.length > 0)
    return (
      <span className="text-live">
        Line {Math.min(done + 1, steps.length)} of {steps.length}
      </span>
    );
  return <span className="text-live">{read.active === "running" ? "Starting" : "Queued"}</span>;
}

/** The line under the name: the bug a failing test found, or why its last run isn't Passed. */
function Under({ test, read, run }: Pick<TestLineProps, "test" | "read" | "run">) {
  const fault = test.faults[0];
  if (read.settled === "failed" && fault)
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-bad">
        <Bug className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{fault.what}</span>
      </p>
    );
  const reason = run?.result?.reason;
  if (read.settled === "passed" || read.settled === "never" || !reason) return null;
  return (
    <p className={cx("truncate text-xs", STATE_TEXT[read.settled])} title={shortSigned(reason)}>
      {shortSigned(reason)}
    </p>
  );
}

/** A test as one line, with the bug it found or the reason it stopped under its name. */
export function TestLine(props: TestLineProps) {
  const { appId, test, read, run, fresh } = props;
  const now = progress(props);
  return (
    <li className={cx("p-1.5", fresh && "animate-in duration-500 fade-in-0 slide-in-from-top-2 motion-reduce:animate-none")}>
      <Line
        className="min-h-11 py-2"
        mark={<StateMark state={read.mark} size="lg" />}
        name={
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <Link href={`/apps/${appId}/tests/${test.id}`} className="min-w-0 font-medium text-pretty outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
                {test.name}
              </Link>
              {fresh && <span className="shrink-0 rounded-full bg-live-soft px-1.5 py-px text-[11px] font-medium text-live">New</span>}
            </span>
            <Under test={test} read={read} run={run} />
          </div>
        }
        status={
          <span>
            {now ?? <span className={STATE_TEXT[read.mark]}>{readLabel(read)}</span>}
            {!now && run?.finishedAt && ` · ${timeAgo(run.finishedAt)}`}
          </span>
        }
        action={<RunButton target={{ appId, testIds: [test.id] }} active={Boolean(read.active)} stopIds={[test.id]} label="Run test" />}
      />
    </li>
  );
}
