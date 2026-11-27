"use client";

import { Play, Square } from "lucide-react";
import { useTransition } from "react";
import { runAllAction, runTestsAction, stopRunsAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";

export type RunTarget = { appId: string } & ({ testIds: string[] } | { all: true });

/** Play, or stop while any of the target's tests is queued or running: an icon on a test's line, a button with its label on a page (`quiet`: outlined, where it isn't the one thing to do). */
export function RunButton({ target, active, label, size = "icon", quiet }: { target: RunTarget; active: boolean; label: string; size?: "icon" | "sm" | "md"; quiet?: boolean }) {
  const [pending, start] = useTransition();
  const onClick = () =>
    start(async () => {
      const testIds = "testIds" in target ? target.testIds : undefined;
      if (active) return stopRunsAction(target.appId, testIds);
      return testIds ? runTestsAction(target.appId, testIds) : runAllAction(target.appId);
    });
  const icon = active ? <Square className="size-3 fill-current" aria-hidden="true" /> : <Play className="size-3.5 fill-current" aria-hidden="true" />;
  if (size === "icon")
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        disabled={pending}
        aria-label={active ? `Stop ${label.toLowerCase()}` : label}
        title={active ? "Stop" : label}
        className={cx("rounded-full text-muted-foreground hover:text-foreground", active && "text-live hover:text-live")}
      >
        {icon}
      </Button>
    );
  return (
    <Button type="button" variant={active || quiet ? "outline" : "default"} size={size === "sm" ? "sm" : "default"} onClick={onClick} disabled={pending}>
      {icon}
      {pending ? (active ? "Stopping…" : "Starting…") : active ? "Stop" : label}
    </Button>
  );
}
