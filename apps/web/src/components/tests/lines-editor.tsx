"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { saveSetupAction } from "@/actions/apps";
import { saveTestAction } from "@/actions/tests";
import { NotCode } from "@/components/tests/not-code";
import { StartsWith, type StartChoices, type Starts } from "@/components/tests/starts-with";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type Kind = "action" | "check";
interface Row {
  key: number;
  type: Kind;
  text: string;
}

let nextKey = 0;
const row = (type: Kind, text: string): Row => ({ key: nextKey++, type, text });

/** The lines of a test or a setup as rows you can reword, reorder, add to and take out. `kinds` lets a line be a check. */
function Rows({ rows, onChange, kinds, disabled }: { rows: Row[]; onChange: (rows: Row[]) => void; kinds: boolean; disabled: boolean }) {
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => {
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(i + by, 0, r!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-start gap-2">
            <span className="w-5 shrink-0 pt-2 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            {kinds && (
              <NativeSelect aria-label={`Step ${i + 1} is`} value={r.type} disabled={disabled} onChange={(e) => set(i, { type: e.target.value as Kind })} className="w-24 shrink-0">
                <NativeSelectOption value="action">Do</NativeSelectOption>
                <NativeSelectOption value="check">Check</NativeSelectOption>
              </NativeSelect>
            )}
            <Textarea
              aria-label={`Step ${i + 1}`}
              rows={1}
              value={r.text}
              disabled={disabled}
              onChange={(e) => set(i, { text: e.target.value })}
              placeholder={r.type === "check" ? "What must be true on the page now" : "What the user does"}
              className="min-h-9 flex-1 resize-y bg-background py-1.5"
            />
            <div className="flex shrink-0 items-center">
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>
                <X aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 pl-7">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...rows, row("action", "")])}>
          <Plus aria-hidden="true" />
          {kinds ? "Something to do" : "Add a step"}
        </Button>
        {kinds && (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...rows, row("check", "")])}>
            <Plus aria-hidden="true" />
            Something to check
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-pretty text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Footer({ error, pending, note, onCancel }: { error?: string; pending: boolean; note: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role={error ? "alert" : undefined} className={error ? "text-sm text-bad" : "text-sm text-pretty text-muted-foreground"}>
        {error ?? note}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export interface TestDraft {
  name: string;
  /** The heading it is listed under. Empty: under none. */
  group: string;
  goal: string;
  startPath: string;
  lines: { type: Kind; text: string }[];
  /** What its new account starts with. Null: what the app sends every new account. */
  fund: Starts;
}

/**
 * A test as fields, opened from its page's menu. A line left as it was keeps its code; a new or reworded
 * one has none until the next repair writes it. Saving or cancelling goes back to `back`. `starts` is there
 * on an app whose tests each get a new account: what this one's starts with can then be said.
 */
export function TestEditor({ testId, test, back, starts, groups = [] }: { testId: string; test: TestDraft; back: string; starts?: StartChoices; groups?: string[] }) {
  const [draft, setDraft] = useState(test);
  const [rows, setRows] = useState<Row[]>(() => test.lines.map((l) => row(l.type, l.text)));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();

  const save = () =>
    start(async () => {
      const r = await saveTestAction(testId, { ...draft, fund: starts ? draft.fund : undefined, lines: rows.filter((l) => l.text.trim()).map(({ type, text }) => ({ type, text: text.trim() })) });
      if (r.error) return setError(r.error);
      router.push(back);
      router.refresh();
    });

  return (
    <form
      className="flex max-w-3xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field id="test-name" label="Name">
        <Input id="test-name" value={draft.name} disabled={pending} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="bg-background" />
      </Field>
      <Field id="test-group" label="Group" hint="The heading it is listed under with the tests like it, such as Deposits. Leave it empty for none.">
        <Input id="test-group" list="test-groups" value={draft.group} disabled={pending} maxLength={40} onChange={(e) => setDraft({ ...draft, group: e.target.value })} className="bg-background" />
        <datalist id="test-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Field>
      <Field id="test-goal" label="Goal" hint="What a user is trying to do, and what they should end up with.">
        <Textarea id="test-goal" rows={2} value={draft.goal} disabled={pending} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} className="bg-background" />
      </Field>
      <Field id="test-start" label="Starts on" hint="The page the test opens, after the app's setup.">
        <Input id="test-start" value={draft.startPath} disabled={pending} onChange={(e) => setDraft({ ...draft, startPath: e.target.value })} className="bg-background font-mono text-sm" />
      </Field>
      {starts && <StartsWith id="test-starts-with" value={draft.fund} onChange={(fund) => setDraft({ ...draft, fund })} choices={starts} disabled={pending} />}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Steps</span>
        <Rows rows={rows} onChange={setRows} kinds disabled={pending} />
      </div>
      <Footer error={error} pending={pending} note="A step you add or reword needs a repair before a run can do it." onCancel={() => router.push(back)} />
    </form>
  );
}

const WORDS = {
  setup: { none: "No setup. Each test starts on its own page with nothing done first.", edit: "Edit the setup", add: "Add a setup", gone: "No steps means no setup." },
  reset: { none: "No reset. Each test starts with the account as the last one left it.", edit: "Edit the reset", add: "Add a reset", gone: "No steps means no reset." },
};

/**
 * What every test starts from: the page the setup opens and the lines it does there, such as
 * connecting the wallet. The reset is the same for a kept account: what puts it back before each test.
 * Saving with no lines removes it.
 */
export function SetupEditor({ appId, which = "setup", setup, canEdit }: { appId: string; which?: "setup" | "reset"; setup?: { startPath: string; steps: { text: string; code: boolean }[] }; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [startPath, setStartPath] = useState(setup?.startPath ?? "/");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const words = WORDS[which];

  if (!editing)
    return (
      <div className="flex flex-col gap-4">
        {setup && setup.steps.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Starts on <span className="font-mono text-foreground">{setup.startPath}</span>
            </p>
            <ol className="flex flex-col divide-y rounded-xl border bg-card shadow-xs">
              {setup.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-pretty">{s.text}</span>
                  {!s.code && <NotCode />}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{words.none}</p>
        )}
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => {
              setStartPath(setup?.startPath ?? "/");
              setRows((setup?.steps ?? []).map((s) => row("action", s.text)));
              setError(undefined);
              setEditing(true);
            }}
          >
            {setup ? words.edit : words.add}
          </Button>
        )}
      </div>
    );

  const save = () =>
    start(async () => {
      const r = await saveSetupAction(appId, { startPath, steps: rows.map((l) => l.text.trim()).filter(Boolean) }, which);
      if (r.error) return setError(r.error);
      setEditing(false);
      router.refresh();
    });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field id={`${which}-start`} label="Starts on">
        <Input id={`${which}-start`} value={startPath} disabled={pending} onChange={(e) => setStartPath(e.target.value)} className="bg-background font-mono text-sm" />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Steps</span>
        <Rows rows={rows} onChange={setRows} kinds={false} disabled={pending} />
      </div>
      <Footer error={error} pending={pending} note={`A step you add or reword needs a repair before a run can do it. ${words.gone}`} onCancel={() => setEditing(false)} />
    </form>
  );
}
