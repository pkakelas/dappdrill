"use client";

import { useState, useTransition } from "react";
import { addTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One sentence; the worker writes the steps and runs it. */
export function AddTest({ appId }: { appId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addTestAction(appId, text);
          if (r.error) return setError(r.error);
          setText("");
          setError(undefined);
        });
      }}
    >
      <Label htmlFor="add-test">Add a test</Label>
      <div className="flex items-center gap-2">
        <Input id="add-test" value={text} onChange={(e) => setText(e.target.value)} disabled={pending} placeholder="Describe it in a sentence, e.g. withdraw half and check the balance" className="flex-1" />
        <Button type="submit" disabled={pending || text.trim().length < 3}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-muted-foreground">It writes the steps from your sentence and runs it.</p>}
    </form>
  );
}
