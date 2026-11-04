"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { updateTestAction } from "@/actions/tests";

interface Spec {
  name: string;
  goal: string;
  expected: string;
  steps: string[];
}

/**
 * The test's goal, expected result and steps. `view` is the server-rendered read view (steps with
 * the run's results); Edit swaps it for fields. Unhappy paths run their base's steps, so theirs are fixed.
 */
export function SpecEditor({ testId, spec, stepsFixed, view, disabled }: { testId: string; spec: Spec; stepsFixed: boolean; view: ReactNode; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(spec);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const open = (addStep = false) => {
    const steps = addStep || spec.steps.length === 0 ? [...spec.steps, ""] : spec.steps;
    setDraft({ ...spec, steps });
    setError(undefined);
    setEditing(true);
    if (addStep) requestAnimationFrame(() => refs.current[steps.length - 1]?.focus());
  };
  const save = () =>
    start(async () => {
      const r = await updateTestAction(testId, draft);
      if (r.error) return setError(r.error);
      setEditing(false);
    });
  const setStep = (i: number, text: string) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? text : s)) }));
  const insertAfter = (i: number) => {
    setDraft((d) => ({ ...d, steps: [...d.steps.slice(0, i + 1), "", ...d.steps.slice(i + 1)] }));
    requestAnimationFrame(() => refs.current[i + 1]?.focus());
  };
  const remove = (i: number) => {
    setDraft((d) => ({ ...d, steps: d.steps.length > 1 ? d.steps.filter((_, j) => j !== i) : [""] }));
    requestAnimationFrame(() => refs.current[Math.max(0, i - 1)]?.focus());
  };

  if (!editing)
    return (
      <div className="relative flex flex-col gap-3">
        {!disabled && (
          <button type="button" className="btn btn-xs absolute -top-2 right-0" onClick={() => open()}>
            Edit
          </button>
        )}
        {view}
        {!disabled && !stepsFixed && (
          <button type="button" className="btn-link w-fit pl-4 font-mono text-[12.5px] text-muted hover:text-ink" onClick={() => open(true)}>
            + Add step
          </button>
        )}
      </div>
    );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditing(false);
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
      }}
    >
      <Field label="Name">
        <input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />
      </Field>
      <Field label="Goal">
        <textarea className="field" rows={2} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} />
      </Field>
      <Field label="Expected result">
        <textarea className="field" rows={2} value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} />
      </Field>
      {!stepsFixed && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="label mb-2">Steps</legend>
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {draft.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right font-mono text-[12px] text-faint">{i + 1}</span>
                <input
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  aria-label={`Step ${i + 1}`}
                  className="field h-10 flex-1"
                  value={s}
                  placeholder="Short and imperative, e.g. Click Deposit"
                  onChange={(e) => setStep(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      insertAfter(i);
                    }
                    if (e.key === "Backspace" && s === "" && draft.steps.length > 1) {
                      e.preventDefault();
                      remove(i);
                    }
                  }}
                />
                <button type="button" aria-label={`Remove step ${i + 1}`} className="btn btn-icon h-9 w-9 border-transparent text-muted hover:text-ink" onClick={() => remove(i)}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn-link ml-7 w-fit text-muted" onClick={() => insertAfter(draft.steps.length - 1)}>
            + Add step
          </button>
          <p className="hint m-0 ml-7 text-[13px]">Enter adds a step below. Unchanged steps keep their recorded clicks.</p>
        </fieldset>
      )}
      {error && <p className="m-0 text-[13px] text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
