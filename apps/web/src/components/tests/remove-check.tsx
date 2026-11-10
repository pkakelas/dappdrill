"use client";

import { useTransition } from "react";
import { removeCheckAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";

/** Takes a kept check off a step; from then on runs don't make it. */
export function RemoveCheck({ testId, step, check }: { testId: string; step: number; check: number }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="ghost" size="xs" className="ml-auto shrink-0 text-muted-foreground" disabled={pending} onClick={() => start(() => removeCheckAction(testId, step, check))}>
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
