"use client";

import { Plus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { addTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One sentence; the worker writes the steps and runs it. */
export function AddTest({ appId, flowId, flowName, onClose }: { appId: string; flowId: string; flowName: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const r = await addTestAction(appId, { id: flowId }, text);
      if (r.error) return setError(r.error);
      setText("");
      setError(undefined);
      onClose();
    });

  return (
    <form
      className="flex flex-col gap-2 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`add-${flowId}`} className="sr-only">
          New test in {flowName}
        </Label>
        <Input
          id={`add-${flowId}`}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          disabled={pending}
          placeholder="Describe it in a sentence, e.g. withdraw half and check the balance"
          className="sm:w-auto sm:flex-1"
        />
        <Button type="submit" size="sm" disabled={pending || text.trim().length < 3}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-muted-foreground">It writes the steps from your sentence and runs it.</p>}
    </form>
  );
}

/** A new flow with its first test. */
export function NewFlow({ appId, first }: { appId: string; first?: boolean }) {
  const [open, setOpen] = useState(Boolean(first));
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const id = useId();

  if (!open)
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="w-fit">
        <Plus aria-hidden="true" />
        New flow
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addTestAction(appId, { name }, text);
          if (r.error) return setError(r.error);
          setName("");
          setText("");
          setError(undefined);
          setOpen(Boolean(first));
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-flow`}>Flow</Label>
          <Input id={`${id}-flow`} autoFocus={!first} value={name} onChange={(e) => setName(e.target.value)} disabled={pending} placeholder="Borrow" maxLength={60} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-test`}>First test</Label>
          <Input id={`${id}-test`} value={text} onChange={(e) => setText(e.target.value)} disabled={pending} placeholder="Borrow 100 USDC against ETH and see the debt" />
        </div>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !name.trim() || text.trim().length < 3}>
          {pending ? "Adding…" : "Add flow"}
        </Button>
        {!first && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
