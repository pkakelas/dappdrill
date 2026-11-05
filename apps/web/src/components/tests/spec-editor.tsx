"use client";

import { Plus, X } from "lucide-react";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { updateTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Spec {
  name: string;
  goal: string;
  expected: string;
  steps: string[];
}

/**
 * The test's goal, expected result and steps. `summary` and `steps` are the server-rendered read view
 * (steps with the run's results); Edit swaps them for fields. Conditions run their test's steps, so theirs are fixed.
 */
export function SpecEditor({
  testId,
  spec,
  stepsFixed,
  summary,
  steps,
  disabled,
}: {
  testId: string;
  spec: Spec;
  stepsFixed: boolean;
  summary: ReactNode;
  steps: ReactNode;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(spec);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const open = (addStep = false) => {
    const drafted = addStep || spec.steps.length === 0 ? [...spec.steps, ""] : spec.steps;
    setDraft({ ...spec, steps: drafted });
    setError(undefined);
    setEditing(true);
    if (addStep) requestAnimationFrame(() => refs.current[drafted.length - 1]?.focus());
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
      <div className="flex flex-col gap-8">
        <div className="relative">
          {summary}
          {!disabled && (
            <Button type="button" variant="ghost" size="xs" className="absolute -top-1 right-0 text-muted-foreground" onClick={() => open()}>
              Edit
            </Button>
          )}
        </div>
        {steps}
        {!disabled && !stepsFixed && (
          <Button type="button" variant="ghost" size="sm" className="-mt-5 -ml-2 w-fit text-muted-foreground" onClick={() => open(true)}>
            <Plus /> Add step
          </Button>
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
      <Field label="Name">{(id) => <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />}</Field>
      <Field label="Goal">{(id) => <Textarea id={id} rows={2} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} />}</Field>
      <Field label="Expected result">{(id) => <Textarea id={id} rows={2} value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} />}</Field>
      {!stepsFixed && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Steps</legend>
          <ol className="flex flex-col gap-1.5">
            {draft.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <Input
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  aria-label={`Step ${i + 1}`}
                  className="flex-1"
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
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove step ${i + 1}`} className="text-muted-foreground" onClick={() => remove(i)}>
                  <X />
                </Button>
              </li>
            ))}
          </ol>
          <Button type="button" variant="ghost" size="sm" className="ml-5 w-fit text-muted-foreground" onClick={() => insertAfter(draft.steps.length - 1)}>
            <Plus /> Add step
          </Button>
          <p className="ml-7 text-sm text-muted-foreground">Enter adds a step below. Unchanged steps keep their recorded clicks.</p>
        </fieldset>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}
