"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { addTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";

/** One sentence; the worker writes the steps and runs it. Sits as the last line of the tests list. */
export function AddTest({ appId }: { appId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const ready = text.trim().length >= 3;

  return (
    <form
      className="flex w-full flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        start(async () => {
          const r = await addTestAction(appId, text);
          if (r.error) return setError(r.error);
          setText("");
          setError(undefined);
        });
      }}
    >
      <div className="flex items-center gap-3">
        <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="Add a test"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          placeholder="Add a test in a sentence, e.g. withdraw half and check the balance"
          className="h-8 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        {ready && (
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Write and run"}
          </Button>
        )}
      </div>
      {error && <p className="pl-7 text-sm text-bad">{error}</p>}
    </form>
  );
}
