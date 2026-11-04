"use client";

import { useActionState, useState } from "react";
import { createAppAction } from "@/actions/apps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";

export function NewAppForm() {
  const [state, act, pending] = useActionState<ActionResult, FormData>(createAppAction, undefined);
  const [note, setNote] = useState(false);
  return (
    <form action={act} className="flex flex-col gap-3" aria-busy={pending}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="url" className="sr-only">
          Your app&apos;s URL
        </label>
        <Input id="url" name="url" required autoFocus autoComplete="url" inputMode="url" spellCheck={false} placeholder="app.example.com" className="h-11 text-base md:text-base sm:flex-1" />
        <Button type="submit" size="lg" className="h-11 px-8" disabled={pending}>
          {pending ? "Starting…" : "Start"}
        </Button>
      </div>
      {note ? (
        <Textarea name="hints" rows={2} maxLength={2000} placeholder="Anything it should know? e.g. the swap is under /trade, use USDC on Base." autoFocus />
      ) : (
        <Button type="button" variant="link" className="h-auto w-fit p-0 text-muted-foreground" onClick={() => setNote(true)}>
          + Add a note
        </Button>
      )}
      {state?.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
