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
import { plural } from "@/lib/format";
import type { StepWithResult } from "./setup-steps";
import { SetupStrip } from "./setup-strip";
import { SectionHead } from "./tile";

interface Setup {
  startPath: string;
  steps: string[];
  when: SetupWhen;
  why?: string;
  /** On a live chain: the steps that put the account back after earlier runs, right after the steps. */
  reset?: string[];
}

const WHEN_HINT: Record<SetupWhen, string> = {
  once: "Runs before the first test. The others start from where it left off.",
  each: "Runs again before every test. Slower, but each test gets what setup gives afresh.",
};

const RESET_HINT = "On a live chain the account keeps what earlier runs left. These steps put it back after the setup, every time it runs.";

/**
 * The steps every test needs first (sign in, get test funds), with how they went on the last run.
 * `live` says the app has a chain tests run on for real, which is when reset steps make sense.
 */
export function SetupCard({ appId, setup, last, live }: { appId: string; setup: Setup | null; last?: { steps: StepWithResult[]; reset?: StepWithResult[]; label: ReactNode; ok: boolean }; live?: boolean }) {
  const [editing, setEditing] = useState(false);

  if (editing) return <SetupForm appId={appId} setup={setup} live={live} onDone={() => setEditing(false)} />;

  if (!setup)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          Add a setup
        </Button>
        <p className="text-sm text-muted-foreground">No setup yet. Every test starts from the app as it opens.</p>
      </div>
    );

  const reset = setup.reset ?? [];
  return (
    <section aria-label="Setup" className="flex flex-col gap-5">
      <SectionHead
        icon={LogIn}
        tint="pink"
        title="Runs before your tests"
        detail={
          <>
            {SETUP_WHEN_LABEL[setup.when]}
            {reset.length > 0 && <> · {plural(reset.length, "reset step")}</>}
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
      {reset.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium">Reset before tests</h3>
            <p className="text-sm text-pretty text-muted-foreground">{RESET_HINT}</p>
          </div>
          <SetupStrip steps={last?.reset ?? reset.map((text) => ({ text }))} />
        </div>
      )}
    </section>
  );
}

function SetupForm({ appId, setup, live, onDone }: { appId: string; setup: Setup | null; live?: boolean; onDone: () => void }) {
  // Reset steps are a live-chain thing: the section shows there, and wherever the setup already has some.
  const withReset = Boolean(live) || (setup?.reset?.length ?? 0) > 0;
  const [draft, setDraft] = useState<Setup>(
    setup ? { ...setup, steps: [...setup.steps, ""], reset: withReset ? [...(setup.reset ?? []), ""] : [] } : { startPath: "/", steps: [""], when: "once", reset: withReset ? [""] : [] },
  );
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const pathId = useId();
  const whenId = useId();

  const save = () =>
    start(async () => {
      const r = await updateSetupAction(appId, draft);
      if (r.error) return setError(r.error);
      onDone();
    });

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

      <StepFields legend="Steps" name="Step" steps={draft.steps} onChange={(steps) => setDraft((d) => ({ ...d, steps }))} placeholder="Short and imperative, e.g. Mint test funds" hint="Enter adds a step below. Unchanged steps keep their recorded clicks." />

      {withReset && <StepFields legend="Reset before tests" name="Reset step" steps={draft.reset ?? [""]} onChange={(reset) => setDraft((d) => ({ ...d, reset }))} placeholder="e.g. Cancel every open order" hint={RESET_HINT} />}

      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {setup && (
          <ConfirmButton className={buttonVariants({ variant: "ghost", size: "sm", className: "ml-auto text-muted-foreground" })} confirm="Click again to remove" busy="Removing…" onConfirm={() => removeSetupAction(appId)}>
            Remove setup
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}

/** A list of one-line steps: Enter adds one below, Backspace on an empty line removes it. Always keeps one line to type in. */
function StepFields({ legend, name, steps, onChange, placeholder, hint }: { legend: string; name: string; steps: string[]; onChange: (steps: string[]) => void; placeholder: string; hint: string }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const setStep = (i: number, text: string) => onChange(steps.map((s, j) => (j === i ? text : s)));
  const insertAfter = (i: number) => {
    onChange([...steps.slice(0, i + 1), "", ...steps.slice(i + 1)]);
    requestAnimationFrame(() => refs.current[i + 1]?.focus());
  };
  const remove = (i: number) => {
    onChange(steps.length > 1 ? steps.filter((_, j) => j !== i) : [""]);
    requestAnimationFrame(() => refs.current[Math.max(0, i - 1)]?.focus());
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <Input
              ref={(el) => {
                refs.current[i] = el;
              }}
              aria-label={`${name} ${i + 1}`}
              className="flex-1"
              value={s}
              placeholder={placeholder}
              onChange={(e) => setStep(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  insertAfter(i);
                }
                if (e.key === "Backspace" && s === "" && steps.length > 1) {
                  e.preventDefault();
                  remove(i);
                }
              }}
            />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name.toLowerCase()} ${i + 1}`} className="text-muted-foreground" onClick={() => remove(i)}>
              <X />
            </Button>
          </li>
        ))}
      </ol>
      <p className="ml-7 text-sm text-pretty text-muted-foreground">{hint}</p>
    </fieldset>
  );
}
