import { ACTIVE_LABEL, oursBroke, settle, SETTLED_LABEL, type Active, type Read, type Settled, type TestRunStatus } from "@dappdrill/core";
import type { TestRunRow } from "@dappdrill/db";
import { Check, Minus, TriangleAlert, X } from "lucide-react";
import { cx } from "@/components/ui";

/** Anything a mark can show: what a test's last result says, a run in progress, a result list's stopped run, a test being written. */
export type TestState = TestRunStatus | Settled | "drafting";

export const STATE_LABEL: Record<TestState, string> = {
  ...SETTLED_LABEL,
  ...ACTIVE_LABEL,
  stopped: "Stopped",
  drafting: "Writing…",
};

/**
 * The mark carries a pass's colour, so its word stays quiet. Failed and Probably failed are bad,
 * Needs your input is warn (as is a single run that couldn't run), Running and Queued are live.
 */
export const STATE_TEXT: Record<TestState, string> = {
  pass: "text-muted-foreground",
  fail: "text-bad",
  probable: "text-bad",
  input: "text-warn",
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
 * A queued or running run never erases the last result; a stopped run doesn't replace it either,
 * nor does one that broke on our side.
 */
export interface TestRead extends Read {
  drafting: boolean;
  /** Hasn't passed yet, so it doesn't run on a schedule. */
  draft: boolean;
  /** Its failure is being tried again in a fresh browser right now. */
  checking: boolean;
  /** Somebody pressed Run and our side broke. It says nothing about the test, only that it's worth another go. */
  ours: boolean;
  /** The mark to draw: the finished result, or the live state when there is no result yet. */
  mark: TestState;
}

export const OUR_ERROR = "There was an error on our side. Try again later.";

/** A second look that hasn't reported back by now never will (the worker went away), so it stops reading as on. */
const LOOK_MS = 15 * 60 * 1000;

type Run = Pick<TestRunRow, "status" | "result" | "finishedAt" | "trigger">;

/** Actions that wait for the pointer, but stay put on touch screens and for the keyboard. */
export const REVEAL = "transition-opacity focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:hover)]:opacity-0";

/** `latest` is the newest run of any status, `settled` the newest one that says something about the test. A condition's failure isn't looked at twice. */
export function readTest(test: { drafting: string | null; draftNote: string | null; baseId: string | null }, latest?: Run, settled?: Run): TestRead {
  const active = latest?.status === "queued" || latest?.status === "running" ? latest.status : undefined;
  const looking = settled?.result?.secondLook?.verdict === "checking" && settled.finishedAt !== null && Date.now() - settled.finishedAt.getTime() < LOOK_MS;
  const read: TestRead = {
    settled: settle(settled, !test.baseId),
    active,
    drafting: Boolean(test.drafting),
    draft: Boolean(test.draftNote),
    checking: false,
    ours: !active && oursBroke(latest) && latest?.trigger === "manual",
    mark: "never",
  };
  read.checking = read.settled === "probable" && looking;
  return withSettled(read, read.settled);
}

/** The same read saying something else, for a line that knows more than its last run (a bug an explorer confirmed). */
export function withSettled(read: TestRead, settled: Settled): TestRead {
  const mark: TestState = read.drafting ? "drafting" : read.active && settled === "never" ? read.active : settled;
  return { ...read, settled, mark };
}

/** Something is still coming for it, so the page keeps refreshing. */
export const isActive = (r: TestRead) => Boolean(r.active) || r.drafting || r.checking;

/** "Passed", "Failed · Running", "Queued"… */
export function readLabel(r: TestRead): string {
  if (r.drafting) return STATE_LABEL.drafting;
  if (r.settled === "never") return r.active ? ACTIVE_LABEL[r.active] : SETTLED_LABEL.never;
  return r.active ? `${SETTLED_LABEL[r.settled]} · ${ACTIVE_LABEL[r.active]}` : SETTLED_LABEL[r.settled];
}

export type { Active, Settled };

/** Probably failed is Failed in outline: the same cross, not filled in until a second look agrees. */
const BOX: Record<TestState, string> = {
  pass: "bg-emerald-500/10 text-emerald-600",
  fail: "bg-rose-500/10 text-rose-600",
  probable: "border border-dashed border-rose-500/50 text-rose-600",
  input: "bg-amber-500/10 text-amber-600",
  error: "bg-amber-500/10 text-amber-600",
  running: "bg-sky-500/10",
  queued: "bg-sky-500/10",
  stopped: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
  never: "bg-muted",
  drafting: "bg-muted",
};

function Glyph({ state, size }: { state: TestState; size: string }) {
  const icon = { className: size, strokeWidth: 2.75, "aria-hidden": true };
  switch (state) {
    case "pass":
      return <Check {...icon} />;
    case "fail":
    case "probable":
      return <X {...icon} />;
    case "input":
      return (
        <span aria-hidden="true" className={cx("leading-none font-bold", size === "size-4" ? "text-[15px]" : "text-xs")}>
          ?
        </span>
      );
    case "error":
      return <TriangleAlert {...icon} strokeWidth={2.25} />;
    case "skipped":
    case "stopped":
      return <Minus {...icon} />;
    case "running":
      return (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50" />
          <span className="relative inline-flex size-2 rounded-full bg-live" />
        </span>
      );
    case "queued":
      return <span className="size-2 rounded-full border-2 border-live" />;
    case "drafting":
      return <span className="size-2 animate-pulse rounded-full bg-muted-foreground/50" />;
    default:
      return <span className="size-2 rounded-full border-2 border-muted-foreground/40" />;
  }
}

/** A result as a small tinted square, the New app page's tile at line size. `size="lg"` is for a test's own line, the default for what nests under it. */
export function StateMark({ state, size = "sm", className }: { state: TestState; size?: "sm" | "lg"; className?: string }) {
  return (
    <span role="img" aria-label={STATE_LABEL[state]} className={cx("inline-flex shrink-0 items-center justify-center", size === "lg" ? "size-7 rounded-lg" : "size-5 rounded-md", BOX[state], className)}>
      <Glyph state={state} size={size === "lg" ? "size-4" : "size-3"} />
    </span>
  );
}
