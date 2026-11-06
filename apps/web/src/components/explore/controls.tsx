"use client";

import { BUG_TRIAGE_LABEL, BugTriage } from "@dappdrill/core";
import { Plus } from "lucide-react";
import { useTransition } from "react";
import { addSuggestedAction, triageBugAction } from "@/actions/explore";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** A person's call on a bug. Accepting it writes a draft test that passes once the bug is fixed. */
export function TriageSelect({ passId, bugId, value }: { passId: string; bugId: string; value: BugTriage }) {
  const [pending, start] = useTransition();
  return (
    <NativeSelect size="sm" aria-label="Your call on this bug" className="w-44" value={value} disabled={pending} onChange={(e) => start(() => triageBugAction(passId, bugId, e.target.value))}>
      {BugTriage.options.map((t) => (
        <NativeSelectOption key={t} value={t}>
          {BUG_TRIAGE_LABEL[t]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Adds one suggested test, or all of them when no id is given. */
export function AddSuggested({ passId, id, label }: { passId: string; id?: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant={id ? "ghost" : "outline"} size="sm" disabled={pending} onClick={() => start(() => addSuggestedAction(passId, id ? [id] : undefined))}>
      {id && <Plus aria-hidden="true" />}
      {pending ? "Adding…" : label}
    </Button>
  );
}
