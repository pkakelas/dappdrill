"use client";

import { Wrench } from "lucide-react";
import { useState, useTransition } from "react";
import { repairTestsAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";

/** Starts a repair: of these tests, or of every test of the app that needs one. What stops it from starting is said beside it. */
export function RepairButton({ appId, testIds, label = "Repair" }: { appId: string; testIds?: string[]; label?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-3">
      {error && (
        <span role="alert" className="text-sm text-bad">
          {error}
        </span>
      )}
      <Button type="button" size="sm" disabled={pending} onClick={() => start(async () => setError((await repairTestsAction(appId, testIds)).error))}>
        <Wrench aria-hidden="true" />
        {pending ? "Starting…" : label}
      </Button>
    </span>
  );
}
