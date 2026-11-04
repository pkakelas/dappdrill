"use client";

import { CONDITIONS, type EdgeCaseId } from "@dappdrill/core";
import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { addUnhappyAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/** Pick conditions to run this happy path under; the new tests run right away. */
export function AddUnhappy({ testId, existing }: { testId: string; existing: EdgeCaseId[] }) {
  const available = CONDITIONS.filter((c) => !existing.includes(c.id));
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<EdgeCaseId[]>(() => available.filter((c) => c.default).map((c) => c.id));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (available.length === 0) return null;

  if (!open)
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)} className="h-auto w-full justify-start gap-2.5 rounded-none px-4 py-3 font-normal text-muted-foreground has-[>svg]:px-4">
        <Plus className="size-4" aria-hidden="true" />
        Add unhappy paths
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-3 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addUnhappyAction(testId, picked);
          if (r.error) return setError(r.error);
          setOpen(false);
        });
      }}
    >
      <fieldset className="flex flex-col gap-1" disabled={pending}>
        <legend className="mb-2 text-sm text-muted-foreground">Runs this test&apos;s steps under each condition and checks the app copes.</legend>
        {available.map((c) => (
          <label key={c.id} htmlFor={`condition-${c.id}`} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent/50">
            <Checkbox
              id={`condition-${c.id}`}
              className="mt-0.5"
              checked={picked.includes(c.id)}
              onCheckedChange={(checked) => setPicked((p) => (checked === true ? [...p, c.id] : p.filter((x) => x !== c.id)))}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{c.name}</span>
              <span className="text-sm leading-snug text-muted-foreground">{c.expected}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || picked.length === 0}>
          {pending ? "Adding…" : picked.length === 1 ? "Add and run 1" : `Add and run ${picked.length}`}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
