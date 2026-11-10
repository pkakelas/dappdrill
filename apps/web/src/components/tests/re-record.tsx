"use client";

import { useTransition } from "react";
import { reRecordAction } from "@/actions/tests";
import { cx } from "@/components/ui";

/**
 * "Re-record": forgets the test's saved steps and runs it, so the agent records them again.
 * A text button for the line under a test; it shows on hover with the row's other actions.
 */
export function ReRecord({ appId, testId, disabled, className }: { appId: string; testId: string; disabled?: boolean; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || disabled}
      onClick={(e) => {
        e.preventDefault();
        start(() => reRecordAction(appId, [testId]));
      }}
      title="Forget the saved steps and record them again on the next run"
      className={cx("relative z-10 shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", className)}
    >
      {pending ? "Re-recording…" : "Re-record"}
    </button>
  );
}
