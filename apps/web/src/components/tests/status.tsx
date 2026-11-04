import type { TestRunStatus } from "@dappdrill/core";
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

export const STATE_TEXT: Record<TestState, string> = {
  pass: "text-muted",
  fail: "text-bad",
  error: "text-ink-2",
  running: "text-live",
  queued: "text-live",
  stopped: "text-muted",
  skipped: "text-faint",
  never: "text-faint",
  drafting: "text-muted",
};

export function stateOf(test: { drafting: string | null }, run?: { status: TestRunStatus }): TestState {
  if (test.drafting) return "drafting";
  return run?.status ?? "never";
}

export const isActive = (s: TestState) => s === "running" || s === "queued" || s === "drafting";

/** A 16px mark. Only failures get colour; a pass is a quiet check. */
export function StateMark({ state, className }: { state: TestState; className?: string }) {
  const box = cx("inline-flex h-4 w-4 shrink-0 items-center justify-center", className);
  const label = STATE_LABEL[state];
  switch (state) {
    case "pass":
      return (
        <span className={cx(box, "text-quiet")} role="img" aria-label={label}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7.5l2.5 2.5L11 4.5" />
          </svg>
        </span>
      );
    case "fail":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bad text-paper">
            <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M2 2l4 4M6 2L2 6" />
            </svg>
          </span>
        </span>
      );
    case "error":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] border-ink-3 font-mono text-[9px] leading-none font-semibold text-ink-3">!</span>
        </span>
      );
    case "running":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-50" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-live" />
          </span>
        </span>
      );
    case "queued":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-live" />
        </span>
      );
    case "drafting":
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-quiet" />
        </span>
      );
    default:
      return (
        <span className={box} role="img" aria-label={label}>
          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-line-strong" />
        </span>
      );
  }
}
