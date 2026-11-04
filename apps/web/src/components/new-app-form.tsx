"use client";

import { useActionState, useState } from "react";
import { createAppAction } from "@/actions/apps";
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
        <input
          id="url"
          name="url"
          required
          autoFocus
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          placeholder="app.example.com"
          className="field h-14 rounded-full sm:flex-1 px-6 font-mono text-[16px]"
        />
        <button type="submit" className="btn btn-primary h-14 px-8" disabled={pending}>
          {pending ? "Starting…" : "Start"}
        </button>
      </div>
      {note ? (
        <textarea name="hints" rows={2} maxLength={2000} className="field" placeholder="Anything it should know? e.g. the swap is under /trade, use USDC on Base." autoFocus />
      ) : (
        <button type="button" className="btn-link w-fit text-muted" onClick={() => setNote(true)}>
          + Add a note
        </button>
      )}
      {state?.error && (
        <p role="alert" className="m-0 text-[14px] text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
