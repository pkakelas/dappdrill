"use client";

import { RotateCcw, X } from "lucide-react";
import { useState, useTransition } from "react";
import { dismissGoalAction, type GoalRef } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { AddTestDialog } from "./add-test";

/** What can be done with a goal that got no test: try it again with what we should know, or dismiss it. */
export function GoalActions({ appId, goal, whyNot, retries }: { appId: string; goal: string; whyNot?: string; retries: GoalRef }) {
  const [open, setOpen] = useState(false);
  const [dismissing, start] = useTransition();
  return (
    <div className="-my-1 flex shrink-0 items-center gap-0.5">
      <Button type="button" variant="ghost" size="sm" title="Try again" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden="true" />
        {/* On a phone the goal needs the width: the icon alone. */}
        <span className="max-sm:sr-only">Try again</span>
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss" title="Dismiss" disabled={dismissing} onClick={() => start(() => dismissGoalAction(appId, retries))} className="text-muted-foreground">
        <X aria-hidden="true" />
      </Button>
      <AddTestDialog appId={appId} open={open} onOpenChange={setOpen} retry={{ goal, whyNot, ...retries }} />
    </div>
  );
}
