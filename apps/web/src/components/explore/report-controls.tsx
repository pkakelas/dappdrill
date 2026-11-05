"use client";

import { BUG_TRIAGE_LABEL, BugTriage } from "@dappdrill/core";
import { useTransition } from "react";
import { pinCheckAction, triageBugAction } from "@/actions/explore";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export function TriageSelect({ explorationId, bugId, value }: { explorationId: string; bugId: string; value: BugTriage }) {
  const [pending, start] = useTransition();
  return (
    <NativeSelect size="sm" aria-label="Your call on this bug" className="w-44" value={value} disabled={pending} onChange={(e) => start(() => triageBugAction(explorationId, bugId, e.target.value))}>
      {BugTriage.options.map((t) => (
        <NativeSelectOption key={t} value={t}>
          {BUG_TRIAGE_LABEL[t]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function MakeTest({ explorationId, checkId }: { explorationId: string; checkId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => start(() => pinCheckAction(explorationId, checkId))}>
      {pending ? "Adding…" : "Make a test"}
    </Button>
  );
}
