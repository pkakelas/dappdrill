"use client";

import { useTransition } from "react";
import { writeTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";

/** Writes the steps of a test that only has a name and a goal, then runs it. */
export function WriteTest({ testId, primary }: { testId: string; primary?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant={primary ? "default" : "ghost"} size={primary ? "default" : "sm"} disabled={pending} onClick={() => start(() => writeTestAction(testId))}>
      {pending ? "Starting…" : "Write test"}
    </Button>
  );
}
