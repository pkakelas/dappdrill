"use client";

import { useState, useTransition } from "react";
import { addTestAction } from "@/actions/tests";
import { cx } from "@/components/ui";

/** "+ Add a test": one sentence; the worker writes the steps and runs it. */
export function AddTest({ appId, flowId, flowName }: { appId: string; flowId: string; flowName: string }) {
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
      <button type="button" onClick={() => setOpen(true)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left font-mono text-[12.5px] text-muted hover:bg-sub hover:text-ink">
        <span className="inline-flex w-4 justify-center text-[15px] leading-none">+</span>
        Add a test
      </button>
    );
  return (
    <form
      className="flex flex-col gap-2 px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`add-${flowId}`} className="sr-only">
          New test in {flowName}
        </label>
        <input
          id={`add-${flowId}`}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          disabled={pending}
          placeholder="Describe it in a sentence, e.g. withdraw half and check the balance"
          className="field h-10 sm:w-auto sm:flex-1"
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending || text.trim().length < 3}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error ? <p className="m-0 text-[13px] text-bad">{error}</p> : <p className="hint m-0 text-[13px]">It writes the steps from your sentence and runs it.</p>}
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

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-sm w-fit">
        + New flow
      </button>
    );
  return (
    <form
      className={cx("card flex flex-col gap-3 p-5")}
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
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="flex flex-col gap-1.5">
          <span className="label">Flow</span>
          <input autoFocus={!first} value={name} onChange={(e) => setName(e.target.value)} disabled={pending} placeholder="Borrow" className="field h-10" maxLength={60} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">First test</span>
          <input value={text} onChange={(e) => setText(e.target.value)} disabled={pending} placeholder="Borrow 100 USDC against ETH and see the debt" className="field h-10" />
        </label>
      </div>
      {error && <p className="m-0 text-[13px] text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending || !name.trim() || text.trim().length < 3}>
          {pending ? "Adding…" : "Add flow"}
        </button>
        {!first && (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
