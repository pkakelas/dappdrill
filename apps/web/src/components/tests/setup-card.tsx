"use client";

import { SETUP_WHEN_LABEL, type SetupWhen } from "@dappdrill/core";
import { LogIn, Pencil, X } from "lucide-react";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { removeSetupAction, updateSetupAction } from "@/actions/apps";
import { ConfirmButton } from "@/components/confirm-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StepWithResult } from "./setup-steps";
import { SetupStrip } from "./setup-strip";
import { SectionHead } from "./tile";

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
      <p className="text-sm text-muted-foreground">
        Every test needs the same first steps, like signing in or getting test funds?{" "}
        <button type="button" onClick={() => setEditing(true)} className="text-foreground underline underline-offset-4">
          Add a setup
        </button>
      </p>
    );

  return (
    <section aria-label="Setup" className="flex flex-col gap-5">
      <SectionHead
        icon={LogIn}
        tint="pink"
        title="Runs before your tests"
        detail={
          <>
            {SETUP_WHEN_LABEL[setup.when]}
            {last && <> · {last.label}</>}
            {setup.why && <> · {setup.why}</>}
          </>
        }
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} className="max-sm:w-8 max-sm:px-0">
            <Pencil aria-hidden="true" />
            <span className="max-sm:sr-only">Edit setup</span>
          </Button>
        }
      />
      <SetupStrip steps={last?.steps ?? setup.steps.map((text) => ({ text }))} />
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
          <Label id={whenId}>Runs</Label>
          <ToggleGroup type="single" variant="outline" aria-labelledby={whenId} value={draft.when} onValueChange={(when) => when && setDraft({ ...draft, when: when as SetupWhen })}>
            {(["once", "each"] as const).map((w) => (
              <ToggleGroupItem key={w} value={w} className="px-3">
                {SETUP_WHEN_LABEL[w]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
