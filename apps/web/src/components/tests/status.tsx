import { ACTIVE_LABEL, readOf, SETTLED_LABEL, type Active, type Read, type Settled, type TestRunStatus } from "@dappdrill/core";
import { Check, CircleAlert, Minus, X } from "lucide-react";
import { cx } from "@/components/ui";

/** Anything a mark can show: a finished result, a run in progress, a result list's stopped run, a draft being written. */
export type TestState = TestRunStatus | "never" | "drafting";

export const STATE_LABEL: Record<TestState, string> = {
  ...SETTLED_LABEL,
  ...ACTIVE_LABEL,
  stopped: "Stopped",
  drafting: "Writing…",
};

/** Only problems get colour: Failed is bad, Couldn't run is warn, Running and Queued are live. */
export const STATE_TEXT: Record<TestState, string> = {
  pass: "text-muted-foreground",
  fail: "text-bad",
  error: "text-warn",
  running: "text-live",
  queued: "text-live",
  stopped: "text-muted-foreground",
  skipped: "text-muted-foreground",
  never: "text-muted-foreground",
  drafting: "text-muted-foreground",
};

/**
 * What a test shows on a page: its latest finished result, and beside it whatever is happening now.
 * A queued or running run never erases the last result; a stopped run doesn't replace it either.
 */
export interface TestRead extends Read {
  drafting: boolean;
  /** The mark to draw: the finished result, or the live state when there is no result yet. */
  mark: TestState;
}

/** Actions that wait for the pointer, but stay put on touch screens and for the keyboard. */
export const REVEAL = "transition-opacity focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:hover)]:opacity-0";

export function readTest(test: { drafting: string | null }, latest?: { status: TestRunStatus }, settled?: { status: TestRunStatus }): TestRead {
  const read = readOf(latest, settled);
  const drafting = Boolean(test.drafting);
  const mark: TestState = drafting ? "drafting" : read.settled === "never" && read.active ? read.active : read.settled;
  return { ...read, drafting, mark };
}

export const isActive = (r: TestRead) => Boolean(r.active) || r.drafting;

/** "Passed", "Failed · Running", "Queued"… */
export function readLabel(r: TestRead): string {
  if (r.drafting) return STATE_LABEL.drafting;
  if (r.settled === "never") return r.active ? ACTIVE_LABEL[r.active] : SETTLED_LABEL.never;
  return r.active ? `${SETTLED_LABEL[r.settled]} · ${ACTIVE_LABEL[r.active]}` : SETTLED_LABEL[r.settled];
}

export type { Active, Settled };

/** A 16px mark. Only problems get colour; a pass is a quiet check. */
export function StateMark({ state, className }: { state: TestState; className?: string }) {
  const box = cx("inline-flex size-4 shrink-0 items-center justify-center", className);
  const label = STATE_LABEL[state];
  switch (state) {
    case "pass":
      return (
        <span className={cx(box, "text-muted-foreground")} role="img" aria-label={label}>
          <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        </span>
      );
    case "fail":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="flex size-3.5 items-center justify-center rounded-full bg-bad text-white">
            <X className="size-2.5" strokeWidth={3} aria-hidden="true" />
          </span>
        </span>
      );
    case "error":
      return (
        <span className={cx(box, "text-warn-icon")} role="img" aria-label={label}>
          <CircleAlert className="size-4" strokeWidth={2.25} aria-hidden="true" />
        </span>
      );
    case "skipped":
      return (
        <span className={cx(box, "text-muted-foreground/60")} role="img" aria-label={label}>
          <Minus className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        </span>
      );
    case "running":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50" />
            <span className="relative inline-flex size-2.5 rounded-full bg-live" />
          </span>
        </span>
      );
    case "queued":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="size-2.5 rounded-full border-2 border-live" />
        </span>
      );
    case "drafting":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="size-2.5 animate-pulse rounded-full bg-muted-foreground/50" />
        </span>
      );
    default:
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="size-2.5 rounded-full border-2 border-muted-foreground/40" />
        </span>
      );
  }
}

/** The small live dot shown beside a finished result while a new run is queued or running. */
export function ActiveDot({ active }: { active?: Active }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-live">
      <StateMark state={active} className="size-3" />
      {ACTIVE_LABEL[active]}
    </span>
  );
}
