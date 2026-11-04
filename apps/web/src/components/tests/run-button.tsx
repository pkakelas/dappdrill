"use client";

import { useTransition } from "react";
import { runAllAction, runFlowAction, runTestsAction, stopRunsAction } from "@/actions/tests";
import { cx, PlayIcon } from "@/components/ui";

export type RunTarget = { appId: string } & ({ testIds: string[] } | { flowId: string } | { all: true });

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
      <rect x="2" y="2" width="8" height="8" rx="1.5" />
    </svg>
  );
}

/**
 * Play, or stop while any of the target's tests is queued or running.
 * `stopIds` are the tests to stop (the running ones in the target).
 */
export function RunButton({
  target,
  active,
  stopIds,
  label,
  size = "icon",
  primary,
  disabled,
}: {
  target: RunTarget;
  active: boolean;
  stopIds?: string[];
  label: string;
  size?: "icon" | "sm" | "md";
  primary?: boolean;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault(); // inside a <summary>, don't also toggle it
    start(async () => {
      if (active) return stopRunsAction(target.appId, "all" in target ? undefined : stopIds);
      if ("testIds" in target) return runTestsAction(target.appId, target.testIds);
      if ("flowId" in target) return runFlowAction(target.flowId);
      return runAllAction(target.appId);
    });
  };
  const text = active ? "Stop" : label;
  if (size === "icon")
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending || disabled}
        aria-label={active ? `Stop ${label.toLowerCase()}` : label}
        title={active ? "Stop" : label}
        className={cx(
          "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent text-ink-3 transition-colors hover:border-line-strong hover:bg-card hover:text-ink disabled:cursor-default disabled:opacity-40",
          active && "text-live hover:text-live",
        )}
      >
        {active ? <StopIcon /> : <PlayIcon />}
      </button>
    );
  return (
    <button type="button" onClick={onClick} disabled={pending || disabled} className={cx("btn", size === "sm" && "btn-sm max-sm:w-10 max-sm:px-0", primary && !active && "btn-primary")}>
      {active ? <StopIcon /> : <PlayIcon />}
      {/* Small ones sit in card headers; on a phone they shrink to the icon. */}
      <span className={cx(size === "sm" && "max-sm:sr-only")}>{pending ? (active ? "Stopping…" : "Starting…") : text}</span>
    </button>
  );
}
