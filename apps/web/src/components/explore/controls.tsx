"use client";

import type { BugTriage } from "@dappdrill/core";
import { FlaskConical, Plus, Undo2 } from "lucide-react";
import { useTransition } from "react";
import { addBugTestAction, addSuggestedAction, setBugAction } from "@/actions/explore";
import { Button } from "@/components/ui/button";

/** Writes a test for a bug the explorer found, so something checks it from now on. */
export function AddBugTest({ passId, bugId, label }: { passId: string; bugId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        // The button sits on the bug's line, which opens on a click.
        e.preventDefault();
        start(() => addBugTestAction(passId, bugId));
      }}
    >
      <FlaskConical aria-hidden="true" />
      {pending ? "Adding…" : label}
    </Button>
  );
}

/** Dismisses a bug, or brings a dismissed one back. Nobody marks a bug fixed; that happens when its test passes. */
export function BugActions({ passId, bugId, triage }: { passId: string; bugId: string; triage: BugTriage }) {
  const [pending, start] = useTransition();
  if (triage === "fixed") return null;
  if (triage === "dismissed")
    return (
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => start(() => setBugAction(passId, bugId, "open"))}>
        <Undo2 aria-hidden="true" />
        Restore
      </Button>
    );
  return (
    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={pending} onClick={() => start(() => setBugAction(passId, bugId, "dismissed"))}>
      Dismiss
    </Button>
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
