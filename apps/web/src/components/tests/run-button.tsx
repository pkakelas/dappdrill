"use client";

import { Play, Square } from "lucide-react";
import { useTransition } from "react";
import { runAllAction, runTestsAction, stopRunsAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";

export type RunTarget = { appId: string } & ({ testIds: string[] } | { all: true });

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
      return runAllAction(target.appId);
    });
  };
  const text = active ? "Stop" : label;
  const icon = active ? <Square className="size-3 fill-current" aria-hidden="true" /> : <Play className="size-3.5 fill-current" aria-hidden="true" />;
  if (size === "icon")
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        disabled={pending || disabled}
        aria-label={active ? `Stop ${label.toLowerCase()}` : label}
        title={active ? "Stop" : label}
        className={cx("rounded-full text-muted-foreground hover:text-foreground", active && "text-live hover:text-live")}
      >
        {icon}
      </Button>
    );
  return (
    <Button
      type="button"
      variant={primary && !active ? "default" : "outline"}
      size={size === "sm" ? "sm" : "default"}
      onClick={onClick}
      disabled={pending || disabled}
      className={cx(size === "sm" && "max-sm:w-8 max-sm:px-0")}
    >
      {icon}
      {/* Small ones sit in card headers; on a phone they shrink to the icon. */}
      <span className={cx(size === "sm" && "max-sm:sr-only")}>{pending ? (active ? "Stopping…" : "Starting…") : text}</span>
    </Button>
  );
}
