import { ACTIVE_LABEL, readOf, SETTLED_LABEL, type Active, type Read, type Settled, type TestRunStatus } from "@dappdrill/core";
import { Check, Minus, TriangleAlert, X } from "lucide-react";
import { cx } from "@/components/ui";

/** Anything a mark can show: a finished result, a run in progress, a result list's stopped run, a draft being written. */
export type TestState = TestRunStatus | "never" | "drafting";

export const STATE_LABEL: Record<TestState, string> = {
  ...SETTLED_LABEL,
  ...ACTIVE_LABEL,
  stopped: "Stopped",
  drafting: "Writing…",
};

/** The mark carries a pass's colour, so its word stays quiet. Failed is bad, Couldn't run is warn, Running and Queued are live. */
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

const BOX: Record<TestState, string> = {
  pass: "bg-emerald-500/10 text-emerald-600",
  fail: "bg-rose-500/10 text-rose-600",
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
      return <X {...icon} />;
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
