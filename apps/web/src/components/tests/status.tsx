import { OUTCOME_LABEL, type LineStatus, type Outcome } from "@dappdrill/core";
import type { TestRunRow } from "@dappdrill/db";
import { Check, Minus, X } from "lucide-react";
import { cx } from "@/components/ui";

/** Anything a mark can show: a test's last result, a run in progress, a run somebody stopped, a test with no result. */
export type TestState = Outcome | "running" | "queued" | "stopped" | "never";

export const STATE_LABEL: Record<TestState, string> = {
  ...OUTCOME_LABEL,
  running: "Running",
  queued: "Queued",
  stopped: "Stopped",
  never: "Not run yet",
};

/** The mark carries a pass's colour, so its word stays quiet. Failed is bad, Couldn't verify is warn, Running and Queued are live. */
export const STATE_TEXT: Record<TestState, string> = {
  passed: "text-muted-foreground",
  failed: "text-bad",
  unverified: "text-warn",
  running: "text-live",
  queued: "text-live",
  stopped: "text-muted-foreground",
  never: "text-muted-foreground",
};

/**
 * What a test shows on a page: its latest finished result, and beside it whatever is happening now.
 * A queued or running run never erases the last result, and a stopped run doesn't replace it either.
 */
export interface TestRead {
  settled: Outcome | "never";
  active?: "queued" | "running";
  /** The mark to draw: the finished result, or the live state when there is no result yet. */
  mark: TestState;
}

type Run = Pick<TestRunRow, "status">;

/** `latest` is the newest run of any status, `settled` the newest finished one. */
export function readTest(latest?: Run, settled?: Run): TestRead {
  const active = latest?.status === "queued" || latest?.status === "running" ? latest.status : undefined;
  const result = settled?.status === "passed" || settled?.status === "failed" || settled?.status === "unverified" ? settled.status : "never";
  return { settled: result, active, mark: result === "never" && active ? active : result };
}

/** "Passed", "Failed · Running", "Queued"… */
export function readLabel(r: TestRead): string {
  if (r.settled === "never") return STATE_LABEL[r.active ?? "never"];
  return r.active ? `${STATE_LABEL[r.settled]} · ${STATE_LABEL[r.active]}` : STATE_LABEL[r.settled];
}

/** A line's control shows on hover where there is one, and always where there isn't. */
export const REVEAL = "transition-opacity focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:hover)]:opacity-0";

const BOX: Record<TestState, string> = {
  passed: "bg-emerald-500/10 text-emerald-600",
  failed: "bg-rose-500/10 text-rose-600",
  unverified: "bg-amber-500/10 text-amber-600",
  running: "bg-sky-500/10",
  queued: "bg-sky-500/10",
  stopped: "bg-muted text-muted-foreground",
  never: "bg-muted",
};

function Glyph({ state, size }: { state: TestState; size: string }) {
  const icon = { className: size, strokeWidth: 2.75, "aria-hidden": true };
  switch (state) {
    case "passed":
      return <Check {...icon} />;
    case "failed":
      return <X {...icon} />;
    case "unverified":
      return (
        <span aria-hidden="true" className={cx("leading-none font-bold", size === "size-4" ? "text-[15px]" : "text-xs")}>
          ?
        </span>
      );
    case "stopped":
      return <Minus {...icon} />;
    case "running":
      return (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-live" />
        </span>
      );
    case "queued":
      return <span className="size-2 rounded-full border-2 border-live" />;
    default:
      return <span className="size-2 rounded-full border-2 border-muted-foreground/40" />;
  }
}

/** A result as a small tinted square, the New app page's tile at line size. `size="lg"` is for a test's own line, the default for a line inside a test. */
export function StateMark({ state, label, size = "sm", className }: { state: TestState; label?: string; size?: "sm" | "lg"; className?: string }) {
  return (
    <span role="img" aria-label={label ?? STATE_LABEL[state]} className={cx("inline-flex shrink-0 items-center justify-center", size === "lg" ? "size-7 rounded-lg" : "size-5 rounded-md", BOX[state], className)}>
      <Glyph state={state} size={size === "lg" ? "size-4" : "size-3"} />
    </span>
  );
}

/** How one line of a test went, drawn with the marks of a whole test. */
export const LINE_STATE: Record<LineStatus, TestState> = { pass: "passed", fail: "failed", unsure: "unverified", skipped: "never" };
export const LINE_LABEL: Record<LineStatus, string> = { pass: "Passed", fail: "Failed", unsure: "Couldn't tell", skipped: "Not reached" };
