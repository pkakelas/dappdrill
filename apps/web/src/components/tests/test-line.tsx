import type { TestRow, TestRunRow } from "@dappdrill/db";
import { Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { unwritten } from "@/lib/lines";
import { RunButton } from "./run-button";
import { readLabel, STATE_TEXT, StateMark, type TestRead, shortReason } from "./status";

/**
 * Where a test stands, each test one way: it found a bug, it failed, a run can't do it as it is (its last one
 * stopped on a step that no longer fits the page, or a step was added or reworded since), or its last result.
 */
export type Stands = "bug" | "failed" | "repair" | "unverified" | "never" | "passed";

export function standsAs(test: TestRow, read: TestRead, settled?: TestRunRow): Stands {
  if (settled?.result?.repairable || unwritten(test)) return "repair";
  if (read.settled === "failed") return test.faults.length > 0 ? "bug" : "failed";
  return read.settled;
}

/** The order of the list: what needs a look first, what passed last. */
export const STANDS_ORDER: Stands[] = ["bug", "failed", "repair", "unverified", "never", "passed"];

/** `run` is the result its status reads from; `live` the newest run, for progress. */
export interface TestLineProps {
  appId: string;
  test: TestRow;
  read: TestRead;
  stands: Stands;
  run?: TestRunRow;
  live?: TestRunRow;
  /** Made ready by the tests being generated now. */
  fresh?: boolean;
}

/** What's happening right now, while a run is on. */
function progress({ read, live }: TestLineProps): string | undefined {
  if (!read.active) return undefined;
  const steps = live?.result?.steps ?? [];
  const done = steps.filter((s) => s.status !== "skipped").length;
  if (read.active === "running" && steps.length > 0) return `Step ${Math.min(done + 1, steps.length)} of ${steps.length}`;
  return read.active === "running" ? "Starting" : "Queued";
}

/** The line under the name: the bug a failing test found, why it can't run, or why its last run isn't Passed. */
function under({ test, read, stands, run }: TestLineProps): { text: string; tone: string } | undefined {
  // Why a test needs repair is said once, where the repair is started.
  if (stands === "repair") return undefined;
  if (stands === "bug") return { text: test.faults[0]!.what, tone: "text-bad" };
  const reason = run?.result?.reason;
  if (read.settled === "passed" || read.settled === "never" || !reason) return undefined;
  return { text: shortReason(reason, read.settled === "failed"), tone: read.settled === "failed" ? "text-bad" : "text-muted-foreground" };
}

/** A test as one line: how it stands, its name with what went wrong under it, and the button that runs it. */
export function TestLine(props: TestLineProps) {
  const { appId, test, read, stands, run, fresh } = props;
  const now = progress(props);
  const note = under(props);
  const repair = stands === "repair";
  return (
    <li className={cx("p-1.5", fresh && "animate-in duration-500 fade-in-0 slide-in-from-top-2 motion-reduce:animate-none")}>
      <div className="relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-foreground/[0.04]">
        {repair ? (
          <span role="img" aria-label="Needs repair" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Wrench className="size-4" aria-hidden="true" />
          </span>
        ) : (
          <StateMark state={read.mark} size="lg" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Link href={`/apps/${appId}/tests/${test.id}`} className="min-w-0 truncate font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
              {test.name}
            </Link>
            {fresh && <span className="shrink-0 rounded-full bg-live-soft px-1.5 py-px text-[11px] font-medium text-live">New</span>}
          </span>
          {note && (
            <p className={cx("truncate text-xs", note.tone)} title={note.text}>
              {note.text}
            </p>
          )}
        </div>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {now ? <span className="text-live">{now}</span> : <span className={repair ? "text-warn" : STATE_TEXT[read.mark]}>{repair ? "Needs repair" : stands === "bug" ? "Bug found" : readLabel(read)}</span>}
          {!now && run?.finishedAt && ` · ${timeAgo(run.finishedAt)}`}
        </span>
        <span className="relative z-10 flex shrink-0 items-center">
          <RunButton target={{ appId, testIds: [test.id] }} active={Boolean(read.active)} label="Run test" />
        </span>
      </div>
    </li>
  );
}

/** The app's tests: one list, with whatever ends it (the field that adds a test) as its last line. */
export function TestList({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <ul className="divide-y rounded-xl border bg-card shadow-xs">
      {children}
      {end && <li className="p-1.5">{end}</li>}
    </ul>
  );
}
