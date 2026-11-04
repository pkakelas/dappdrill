"use client";

import { SETUP_WHEN_LABEL, type SetupWhen } from "@dappdrill/core";
import { ChevronRight, Plus, X } from "lucide-react";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { removeSetupAction, updateSetupAction } from "@/actions/apps";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StepList, type StepWithResult } from "./setup-steps";

interface Setup {
  startPath: string;
  steps: string[];
  when: SetupWhen;
  why?: string;
}

const WHEN_HINT: Record<SetupWhen, string> = {
  once: "Runs before the first test. The others start from where it left off.",
  each: "Runs again before every test. Slower, but each test gets what setup gives afresh.",
};

/** The steps every test needs first (sign in, get test funds), with how they went on the last run. */
export function SetupCard({ appId, setup, last }: { appId: string; setup: Setup | null; last?: { steps: StepWithResult[]; label: ReactNode; ok: boolean } }) {
  const [editing, setEditing] = useState(false);

  if (editing) return <SetupForm appId={appId} setup={setup} onDone={() => setEditing(false)} />;

  if (!setup)
    return (
      <section aria-label="Setup" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-5 py-3">
        <p className="text-sm text-muted-foreground">No setup. Add one when every test needs the same steps first, like signing in or getting test funds.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Plus /> Add setup
        </Button>
      </section>
    );

  return (
    <section aria-label="Setup" className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-start gap-3 border-b px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-semibold">Setup</h2>
          <p className="text-sm text-muted-foreground">
            {SETUP_WHEN_LABEL[setup.when]}
            {setup.why ? ` · ${setup.why}` : ""}
            {last && <> · {last.label}</>}
          </p>
        </div>
        <Button type="button" variant="outline" size="xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
      {/* Folded once it passed: the tests below are what matters then. */}
      <details open={!last?.ok} className="group/setup">
        <summary className="flex cursor-pointer items-center gap-1.5 px-5 py-2 text-sm text-muted-foreground hover:bg-accent/40 group-open/setup:border-b">
          <span className="min-w-0 truncate">{setup.steps.join(" → ")}</span>
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open/setup:rotate-90" />
        </summary>
        <StepList steps={last?.steps ?? setup.steps.map((text) => ({ text }))} />
      </details>
    </section>
  );
}

function SetupForm({ appId, setup, onDone }: { appId: string; setup: Setup | null; onDone: () => void }) {
  const [draft, setDraft] = useState<Setup>(setup ? { ...setup, steps: [...setup.steps, ""] } : { startPath: "/", steps: [""], when: "once" });
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const pathId = useId();
  const whenId = useId();

  const save = () =>
    start(async () => {
      const r = await updateSetupAction(appId, draft);
      if (r.error) return setError(r.error);
      onDone();
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

  return (
    <form
      aria-label="Edit setup"
      className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-xs"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Setup</h2>
        <p className="text-sm text-muted-foreground">Steps every test needs first, like signing in or getting test funds. Keep them out of the tests themselves.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={whenId}>Runs</Label>
          <NativeSelect id={whenId} className="w-full" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value as SetupWhen })}>
            {(["once", "each"] as const).map((w) => (
              <NativeSelectOption key={w} value={w}>
                {SETUP_WHEN_LABEL[w]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">{WHEN_HINT[draft.when]}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={pathId}>Starts on</Label>
          <Input id={pathId} value={draft.startPath} onChange={(e) => setDraft({ ...draft, startPath: e.target.value })} placeholder="/" />
        </div>
      </div>

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
                placeholder="Short and imperative, e.g. Mint test funds"
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
        <p className="ml-7 text-sm text-muted-foreground">Enter adds a step below. Unchanged steps keep their recorded clicks.</p>
      </fieldset>

      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {setup && (
          <ConfirmButton className={buttonVariants({ variant: "ghost", size: "sm", className: "ml-auto text-muted-foreground" })} confirm="Click again to remove" onConfirm={() => removeSetupAction(appId)}>
            Remove setup
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}
