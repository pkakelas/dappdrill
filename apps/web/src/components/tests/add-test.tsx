"use client";

import { Plus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { addFlowAction, addTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "+ Add a test": one sentence; the worker writes the steps and runs it. `first` for a flow that has none yet. */
export function AddTest({ appId, flowId, flowName, first }: { appId: string; flowId: string; flowName: string; first?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const r = await addTestAction(appId, { id: flowId }, text);
      if (r.error) return setError(r.error);
      setText("");
      setError(undefined);
      setOpen(false);
    });

  if (!open)
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)} className="h-auto w-full justify-start gap-2.5 rounded-none px-4 py-3 font-normal text-muted-foreground has-[>svg]:px-4">
        <Plus className="size-4" aria-hidden="true" />
        {first ? "Add the first test" : "Add a test"}
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2 px-4 py-3"
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
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          disabled={pending}
          placeholder="Describe it in a sentence, e.g. withdraw half and check the balance"
          className="sm:w-auto sm:flex-1"
        />
        <Button type="submit" size="sm" disabled={pending || text.trim().length < 3}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-muted-foreground">It writes the steps from your sentence and runs it.</p>}
    </form>
  );
}

/** A new flow, with its first test when you already know one. Without it the flow shows as Not tested. */
export function NewFlow({ appId, first }: { appId: string; first?: boolean }) {
  const [open, setOpen] = useState(Boolean(first));
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
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
          const r = text.trim() ? await addTestAction(appId, { name, goal }, text) : await addFlowAction(appId, name, goal);
          if (r.error) return setError(r.error);
          setGoal("");
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
          <Label htmlFor={`${id}-goal`}>
            Goal <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id={`${id}-goal`} value={goal} onChange={(e) => setGoal(e.target.value)} disabled={pending} placeholder="Take a USDC loan against the deposit" maxLength={300} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor={`${id}-test`}>
            First test <span className="font-normal text-muted-foreground">(optional; without one the flow shows as Not tested)</span>
          </Label>
          <Input id={`${id}-test`} value={text} onChange={(e) => setText(e.target.value)} disabled={pending} placeholder="Borrow 100 USDC against ETH and see the debt" />
        </div>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !name.trim() || (text.trim().length > 0 && text.trim().length < 3)}>
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
