"use client";

import { useState, useTransition } from "react";
import { addTestAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One sentence; the worker writes the steps and runs it. */
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
      <div className="relative">
        <Input
          aria-label="Add a test"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          placeholder="e.g. Withdraw half and check the balance"
          className={cx("h-11 bg-background px-3.5 transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/25", ready && "pr-32")}
        />
        {ready && (
          <Button type="submit" size="sm" disabled={pending} className="absolute top-1/2 right-1.5 -translate-y-1/2">
            {pending ? "Adding…" : "Write and run"}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  );
}
