"use client";

import { describeStep, type Flow, type Locator, type ParamDef, type Step, type StepKind, type WalletExpectation } from "@dappdrill/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveFlowAction, type ActionResult } from "@/actions/flows";
import { cx } from "@/components/ui";
import { Feedback } from "./forms";
import { WithParams } from "./steps-preview";

const NEW_STEP: Record<StepKind, Step> = {
  goto: { kind: "goto", url: "/" },
  click: { kind: "click", target: { role: "button", name: "" } },
  fill: { kind: "fill", target: { label: "" }, value: "" },
  select: { kind: "select", target: { label: "" }, value: "" },
  press: { kind: "press", key: "Enter" },
  wait: { kind: "wait", until: "text", text: "" },
  wallet: { kind: "wallet", respond: "approve" },
  expect: { kind: "expect", assert: { type: "visible", text: "" } },
  "email-code": { kind: "email-code", target: { label: "Code" } },
};

const KIND_LABEL: Record<StepKind, string> = {
  goto: "Open a page",
  click: "Click",
  fill: "Type into a field",
  select: "Choose an option",
  press: "Press a key",
  wait: "Wait",
  wallet: "Wallet request",
  expect: "Check the page",
  "email-code": "Enter emailed code",
};

/** Numbered step list with inline editing, plus the flow's inputs. Saves the whole definition. */
export function StepsEditor({ flow: initial, readOnly }: { flow: Flow; readOnly?: boolean }) {
  const [flow, setFlow] = useState<Flow>(initial);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState<StepKind | "">("");
  const [state, setState] = useState<ActionResult>(undefined);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = JSON.stringify(flow) !== JSON.stringify(initial);

  const setStep = (i: number, s: Step) => setFlow((f) => ({ ...f, steps: f.steps.map((x, j) => (j === i ? s : x)) }));
  const move = (i: number, d: -1 | 1) =>
    setFlow((f) => {
      const steps = [...f.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + d, 0, s!);
      return { ...f, steps };
    });
  const remove = (i: number) => {
    setFlow((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }));
    setEditing(null);
  };
  const add = (kind: StepKind) => {
    setFlow((f) => ({ ...f, steps: [...f.steps, structuredClone(NEW_STEP[kind])] }));
    setEditing(flow.steps.length);
    setAdding("");
  };
  const save = () =>
    start(async () => {
      const res = await saveFlowAction(initial.id, JSON.stringify(flow));
      setState(res);
      if (!res?.error) {
        setEditing(null);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <ol className="m-0 list-none rounded-xl border border-line bg-white p-0" aria-label="Steps">
        {flow.steps.map((s, i) => (
          <li key={i} className={cx("border-b border-divide last:border-b-0", editing === i && "bg-sub")}>
            <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5">
              <span className="pt-0.5 font-mono text-[13px] text-faint">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[15px]">
                  <WithParams text={describeStep(s)} />
                  {s.optional && <span className="text-[13px] text-muted"> (optional)</span>}
                </span>
                {s.kind === "wallet" && <ExpectSummary step={s} />}
              </div>
              <div className="flex items-center gap-1.5">
                {s.kind === "wallet" && <span className="rounded-md bg-hair px-2 py-0.5 text-xs font-medium text-ink-2">Wallet</span>}
                {!readOnly && (
                  <button type="button" className="btn btn-xs" onClick={() => setEditing(editing === i ? null : i)} aria-expanded={editing === i}>
                    {editing === i ? "Done" : "Edit"}
                  </button>
                )}
              </div>
            </div>
            {editing === i && (
              <div className="flex flex-col gap-4 border-t border-divide px-4 py-4 sm:pl-[60px]">
                <StepFields step={s} params={flow.params} onChange={(n) => setStep(i, n)} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-xs" disabled={i === 0} onClick={() => (move(i, -1), setEditing(i - 1))}>
                    Move up
                  </button>
                  <button type="button" className="btn btn-xs" disabled={i === flow.steps.length - 1} onClick={() => (move(i, 1), setEditing(i + 1))}>
                    Move down
                  </button>
                  <button type="button" className="btn btn-xs text-bad" onClick={() => remove(i)}>
                    Delete step
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {flow.steps.length === 0 && <li className="px-4 py-4 text-sm text-muted">No steps yet.</li>}
      </ol>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="add-step" className="sr-only">
            Add a step
          </label>
          <select id="add-step" className="field h-9 w-auto py-0 text-sm" value={adding} onChange={(e) => add(e.target.value as StepKind)}>
            <option value="" disabled>
              Add a step…
            </option>
            {(Object.keys(KIND_LABEL) as StepKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}

      <Params params={flow.params} readOnly={readOnly} onChange={(params) => setFlow((f) => ({ ...f, params }))} />

      {!readOnly && (dirty || state) && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-md">
          {dirty ? <span className="text-sm text-ink-2">Unsaved changes</span> : <Feedback state={state} />}
          {dirty && state?.error && <Feedback state={state} />}
          <span className="flex-1" />
          {dirty && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => (setFlow(initial), setEditing(null), setState(undefined))}>
                Discard
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save flow"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ExpectSummary({ step }: { step: Extract<Step, { kind: "wallet" }> }) {
  const e = step.expect;
  if (!e) return <span className="text-[13px] text-muted">No checks on this request yet.</span>;
  const parts = [
    e.functionName && `calls ${e.functionName}`,
    e.spenderMustBe && `spender must be ${e.spenderMustBe}`,
    e.amountMustEqual && `amount must equal ${e.amountMustEqual}`,
    e.failIfUnlimited && "fails if unlimited",
    e.alsoAcceptPermit2 && "Permit2 also accepted",
  ].filter(Boolean) as string[];
  return (
    <span className="text-[13px] text-muted">
      <WithParams text={parts.length ? `Expect: ${parts.join(", ")}` : "No checks on this request yet."} />
    </span>
  );
}

function Text({ label, value, onChange, mono, placeholder }: { label: string; value?: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <label className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
      <span className="label">{label}</span>
      <input className={cx("field h-10", mono && "font-mono text-sm")} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-ink" />
      {label}
    </label>
  );
}

const opt = (v: string) => (v.trim() === "" ? undefined : v);

function LocatorFields({ value, onChange }: { value?: Locator; onChange: (l: Locator) => void }) {
  const l = value ?? {};
  const set = (k: keyof Locator, v: string) => onChange({ ...l, [k]: opt(v) });
  return (
    <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
      <legend className="mb-1.5 text-[13px] text-muted">Find the element by (first match wins: test id, role + name, label, text, CSS)</legend>
      <Text label="Role" value={l.role} onChange={(v) => set("role", v)} placeholder="button" />
      <Text label="Name" value={l.name} onChange={(v) => set("name", v)} placeholder="Deposit" />
      <Text label="Label" value={l.label} onChange={(v) => set("label", v)} />
      <Text label="Text" value={l.text} onChange={(v) => set("text", v)} />
      <Text label="Test id" value={l.testId} onChange={(v) => set("testId", v)} mono />
      <Text label="CSS" value={l.css} onChange={(v) => set("css", v)} mono />
    </fieldset>
  );
}

function StepFields({ step, params, onChange }: { step: Step; params: ParamDef[]; onChange: (s: Step) => void }) {
  const common = (
    <div className="flex flex-wrap items-end gap-3">
      <Text label="Description (optional)" value={step.note} onChange={(v) => onChange({ ...step, note: opt(v) })} placeholder={describeStep({ ...step, note: undefined })} />
      <Check label="Optional step" checked={step.optional} onChange={(v) => onChange({ ...step, optional: v || undefined })} />
    </div>
  );
  switch (step.kind) {
    case "goto":
      return (
        <>
          <Text label="URL or path" value={step.url} onChange={(url) => onChange({ ...step, url })} mono />
          {common}
        </>
      );
    case "click":
    case "email-code":
      return (
        <>
          <LocatorFields value={step.target} onChange={(target) => onChange({ ...step, target })} />
          {common}
        </>
      );
    case "fill":
    case "select":
      return (
        <>
          <Text label={step.kind === "fill" ? "Text to type ({{param}} allowed)" : "Option"} value={step.value} onChange={(value) => onChange({ ...step, value })} />
          <LocatorFields value={step.target} onChange={(target) => onChange({ ...step, target })} />
          {common}
        </>
      );
    case "press":
      return (
        <>
          <Text label="Key" value={step.key} onChange={(key) => onChange({ ...step, key })} placeholder="Enter" />
          {common}
        </>
      );
    case "wait":
      return (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label">Wait for</span>
              <select className="field h-10" value={step.until} onChange={(e) => onChange({ ...step, until: e.target.value as "text" | "ms" | "idle" })}>
                <option value="text">Some text to appear</option>
                <option value="ms">A fixed time</option>
                <option value="idle">The page to settle</option>
              </select>
            </label>
            {step.until === "text" && <Text label="Text" value={step.text} onChange={(text) => onChange({ ...step, text })} />}
            {step.until === "ms" && <Text label="Milliseconds" value={String(step.ms ?? "")} onChange={(v) => onChange({ ...step, ms: Number(v) || undefined })} />}
          </div>
          {common}
        </>
      );
    case "expect": {
      const a = step.assert;
      return (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label">Check that</span>
              <select
                className="field h-10"
                value={a.type}
                onChange={(e) => {
                  const type = e.target.value as typeof a.type;
                  const text = a.type === "url" ? a.contains : a.text;
                  onChange({ ...step, assert: type === "url" ? { type, contains: text } : { type, text } });
                }}
              >
                <option value="visible">The page shows</option>
                <option value="not-visible">The page doesn&apos;t show</option>
                <option value="url">The URL contains</option>
              </select>
            </label>
            <Text
              label={a.type === "url" ? "Part of the URL" : "Text"}
              value={a.type === "url" ? a.contains : a.text}
              onChange={(v) => onChange({ ...step, assert: a.type === "url" ? { type: "url", contains: v } : { type: a.type, text: v } })}
            />
          </div>
          {common}
        </>
      );
    }
    case "wallet":
      return (
        <>
          <WalletFields step={step} params={params} onChange={onChange} />
          {common}
        </>
      );
  }
}

function WalletFields({ step, params, onChange }: { step: Extract<Step, { kind: "wallet" }>; params: ParamDef[]; onChange: (s: Step) => void }) {
  const e = step.expect ?? {};
  const set = (patch: Partial<WalletExpectation>) => {
    const next = { ...e, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false && v !== "")) as WalletExpectation;
    onChange({ ...step, expect: Object.keys(clean).length ? clean : undefined });
  };
  const amountParam = e.amountMustEqual?.match(/^\{\{\s*([\w-]+)\s*\}\}$/)?.[1];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">In the wallet</span>
          <select className="field h-10" value={step.respond} onChange={(ev) => onChange({ ...step, respond: ev.target.value as "approve" | "reject" })}>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Request type</span>
          <select className="field h-10" value={e.kind ?? ""} onChange={(ev) => set({ kind: (ev.target.value || undefined) as WalletExpectation["kind"] })}>
            <option value="">Any</option>
            <option value="transaction">Transaction</option>
            <option value="message">Message</option>
            <option value="typedData">Typed data</option>
          </select>
        </label>
        <Text label="Function" value={e.functionName} onChange={(v) => set({ functionName: opt(v) })} mono placeholder="approve" />
      </div>
      <div className="flex flex-wrap gap-3">
        <Text label="Contract must be" value={e.to} onChange={(v) => set({ to: opt(v) })} mono placeholder="0x…" />
        <Text label="Spender must be" value={e.spenderMustBe} onChange={(v) => set({ spenderMustBe: opt(v) })} mono placeholder="0x…" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">Amount must equal</span>
          <select
            className="field h-10"
            value={amountParam ? `param:${amountParam}` : e.amountMustEqual ? "fixed" : ""}
            onChange={(ev) => {
              const v = ev.target.value;
              set({ amountMustEqual: v === "" ? undefined : v.startsWith("param:") ? `{{${v.slice(6)}}}` : (amountParam ? "" : e.amountMustEqual) || "0" });
            }}
          >
            <option value="">Don&apos;t check</option>
            {params.map((p) => (
              <option key={p.name} value={`param:${p.name}`}>
                Input “{p.name}”
              </option>
            ))}
            <option value="fixed">A fixed amount</option>
          </select>
        </label>
        {e.amountMustEqual && !amountParam && <Text label="Amount (human units)" value={e.amountMustEqual} onChange={(v) => set({ amountMustEqual: v })} mono />}
      </div>
      <div className="flex flex-col gap-2">
        <Check label="Fail if the approval is unlimited" checked={e.failIfUnlimited} onChange={(v) => set({ failIfUnlimited: v })} />
        <Check label="Also accept a Permit2 signature instead" checked={e.alsoAcceptPermit2} onChange={(v) => set({ alsoAcceptPermit2: v })} />
      </div>
    </div>
  );
}

function Params({ params, readOnly, onChange }: { params: ParamDef[]; readOnly?: boolean; onChange: (p: ParamDef[]) => void }) {
  const set = (i: number, patch: Partial<ParamDef>) => onChange(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <section aria-labelledby="inputs" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="inputs" className="h2">
          Inputs
        </h2>
        {!readOnly && (
          <button type="button" className="btn-link" onClick={() => onChange([...params, { name: `input${params.length + 1}`, default: "" }])}>
            Add input
          </button>
        )}
      </div>
      {params.length === 0 ? (
        <p className="hint m-0">No inputs. Use {"{{name}}"} in a step to make a value changeable per variation.</p>
      ) : (
        <ul className="card m-0 list-none divide-y divide-divide p-0">
          {params.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {readOnly ? (
                <>
                  <span className="param">{p.name}</span>
                  <span className="text-sm">{p.default}</span>
                  {p.description && <span className="text-[13px] text-muted">{p.description}</span>}
                </>
              ) : (
                <>
                  <input aria-label="Input name" className="field h-9 w-36 font-mono text-sm" value={p.name} onChange={(e) => set(i, { name: e.target.value.replace(/[^\w-]/g, "") })} />
                  <input aria-label={`Default for ${p.name}`} className="field h-9 min-w-0 flex-1" value={p.default} placeholder="Default value" onChange={(e) => set(i, { default: e.target.value })} />
                  <button type="button" className="btn btn-xs" onClick={() => onChange(params.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
