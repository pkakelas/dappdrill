import type { TestRunStatus } from "@dappdrill/core";
import { Check, CircleAlert, X } from "lucide-react";
import { cx } from "@/components/ui";

/** A test's state on the page: its latest run, or what's happening to it. */
export type TestState = TestRunStatus | "never" | "drafting";

export const STATE_LABEL: Record<TestState, string> = {
  pass: "Passed",
  fail: "Failed",
  error: "Couldn't run",
  running: "Running",
  queued: "Queued",
  stopped: "Stopped",
  skipped: "Skipped",
  never: "Not run yet",
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

export function stateOf(test: { drafting: string | null }, run?: { status: TestRunStatus }): TestState {
  if (test.drafting) return "drafting";
  return run?.status ?? "never";
}

export const isActive = (s: TestState) => s === "running" || s === "queued" || s === "drafting";

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
