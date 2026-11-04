"use client";

import { CONDITIONS, type EdgeCaseId } from "@dappdrill/core";
import { useState, useTransition } from "react";
import { addUnhappyAction } from "@/actions/tests";

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
      <button type="button" onClick={() => setOpen(true)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left font-mono text-[12.5px] text-muted hover:bg-sub hover:text-ink">
        <span className="inline-flex w-4 justify-center text-[15px] leading-none">+</span>
        Add unhappy paths
      </button>
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
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" disabled={pending}>
        <legend className="hint mb-2 text-[13px]">Runs this test&apos;s steps under each condition and checks the app copes.</legend>
        {available.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1.5 hover:bg-sub">
            <input
              type="checkbox"
              className="mt-[5px] accent-ink"
              checked={picked.includes(c.id)}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
            />
            <span className="flex flex-col">
              <span className="text-[14.5px]">{c.name}</span>
              <span className="text-[12.5px] leading-snug text-muted">{c.expected}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="m-0 text-[13px] text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending || picked.length === 0}>
          {pending ? "Adding…" : picked.length === 1 ? "Add and run 1" : `Add and run ${picked.length}`}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
