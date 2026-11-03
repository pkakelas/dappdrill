import { z } from "zod";

/**
 * How a step finds its element. Resolved in order: testId, role+name, label,
 * placeholder, text, css. Recorded from the accessibility tree so replays
 * survive cosmetic changes.
 */
export const Locator = z.object({
  testId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
  css: z.string().optional(),
  /** Pick the nth match (0-based) when several elements match. */
  nth: z.number().int().nonnegative().optional(),
  /** Restrict the search to a dialog (wallet pickers usually live in one). */
  withinDialog: z.boolean().optional(),
});
export type Locator = z.infer<typeof Locator>;

/** What a wallet request inside a flow must look like. Checked on every replay. */
export const WalletExpectation = z.object({
  kind: z.enum(["transaction", "message", "typedData"]).optional(),
  /** Contract the transaction must go to. */
  to: z.string().optional(),
  /** Function name, or its 4-byte selector ("0xa1903eab") when the recorder couldn't decode the call. */
  functionName: z.string().optional(),
  spenderMustBe: z.string().optional(),
  /** Human units, may reference a param: "{{amount}}". */
  amountMustEqual: z.string().optional(),
  failIfUnlimited: z.boolean().optional(),
  alsoAcceptPermit2: z.boolean().optional(),
});
export type WalletExpectation = z.infer<typeof WalletExpectation>;

const base = {
  id: z.string().optional(),
  /** Plain-English description shown in the UI ("Click Deposit"). */
  note: z.string().optional(),
  optional: z.boolean().optional(),
};

export const Step = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("goto"), url: z.string() }),
  z.object({ ...base, kind: z.literal("click"), target: Locator }),
  /** `value` may contain {{param}} placeholders. */
  z.object({ ...base, kind: z.literal("fill"), target: Locator, value: z.string() }),
  z.object({ ...base, kind: z.literal("select"), target: Locator, value: z.string() }),
  z.object({ ...base, kind: z.literal("press"), key: z.string(), target: Locator.optional() }),
  z.object({
    ...base,
    kind: z.literal("wait"),
    until: z.enum(["text", "ms", "idle"]),
    text: z.string().optional(),
    ms: z.number().int().optional(),
  }),
  /**
   * Handle the next signing request (transaction / message / typed data).
   * Connection and network-switch requests are approved automatically.
   */
  z.object({
    ...base,
    kind: z.literal("wallet"),
    respond: z.enum(["approve", "reject"]).default("approve"),
    expect: WalletExpectation.optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("expect"),
    assert: z.discriminatedUnion("type", [
      z.object({ type: z.literal("visible"), text: z.string() }),
      z.object({ type: z.literal("not-visible"), text: z.string() }),
      z.object({ type: z.literal("url"), contains: z.string() }),
    ]),
  }),
  /** Read the latest email in the test inbox and type the code it contains. */
  z.object({ ...base, kind: z.literal("email-code"), target: Locator }),
]);
export type Step = z.infer<typeof Step>;
export type StepKind = Step["kind"];

export const ParamDef = z.object({
  name: z.string(),
  default: z.string(),
  description: z.string().optional(),
});
export type ParamDef = z.infer<typeof ParamDef>;

export const FlowOrigin = z.enum(["discovered", "described", "recorded", "code"]);
export type FlowOrigin = z.infer<typeof FlowOrigin>;

const FlowBase = z.object({
  id: z.string(),
  name: z.string(),
  origin: FlowOrigin,
  /** Absolute URL, or a path relative to the app URL. */
  startUrl: z.string(),
  params: z.array(ParamDef).default([]),
  steps: z.array(Step),
  /** Chain the flow expects the wallet to be on. */
  chainId: z.number().int().optional(),
});

/** A deterministic, replayable script. Replays make no model calls. */
export const Flow = FlowBase.extend({
  /**
   * Flows replayed first, with default params, to put the chain in the state
   * this one needs (a deposit before a withdraw). Copies, so a flow file is
   * self-contained. Edge cases apply only to the flow itself.
   */
  setup: z.array(FlowBase).optional(),
});
export type Flow = z.infer<typeof Flow>;

export const WalletProfileId = z.enum(["metamask", "rabby", "coinbase"]);
export type WalletProfileId = z.infer<typeof WalletProfileId>;

/** One row of the "Variations" table: run the same flow with other inputs. */
export const Variation = z.object({
  id: z.string(),
  name: z.string(),
  inputs: z.record(z.string(), z.string()).default({}),
  wallet: WalletProfileId.optional(),
  chainId: z.number().int().optional(),
  account: z.enum(["A", "B"]).optional(),
});
export type Variation = z.infer<typeof Variation>;

/**
 * Whether a call is the function an expectation names. Recorded expectations
 * hold a bare selector when the recorder had no ABI for the call, while replays
 * decode the name from a richer ABI, so a selector matches the calldata instead.
 */
export function matchesFunction(expected: string, call: { functionName?: string; calldata?: string }): boolean {
  if (/^0x[0-9a-f]{8}$/i.test(expected)) return call.calldata?.slice(0, 10).toLowerCase() === expected.toLowerCase();
  return call.functionName?.toLowerCase() === expected.toLowerCase();
}

/** Replace {{param}} placeholders with values. Unknown params are left as-is. */
export function applyParams(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, name: string) => values[name] ?? m);
}

export function paramValues(flow: Flow, inputs: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of flow.params) out[p.name] = inputs[p.name] ?? p.default;
  return { ...out, ...inputs };
}

/** Short human description of a step, used in logs, reports and the flow editor. */
export function describeStep(step: Step): string {
  if (step.note) return step.note;
  const t = (l?: Locator) => (l ? (l.name ?? l.text ?? l.label ?? l.placeholder ?? l.testId ?? l.css ?? "element") : "page");
  switch (step.kind) {
    case "goto": return `Open ${step.url}`;
    case "click": return `Click "${t(step.target)}"`;
    case "fill": return `Type "${step.value}" into "${t(step.target)}"`;
    case "select": return `Choose "${step.value}" in "${t(step.target)}"`;
    case "press": return `Press ${step.key}`;
    case "wait": return step.until === "text" ? `Wait for "${step.text}"` : step.until === "ms" ? `Wait ${step.ms}ms` : "Wait for the page to settle";
    case "wallet": return step.respond === "reject" ? "Reject in wallet" : "Approve in wallet";
    case "expect":
      return step.assert.type === "url" ? `URL contains "${step.assert.contains}"` : step.assert.type === "visible" ? `See "${step.assert.text}"` : `Don't see "${step.assert.text}"`;
    case "email-code": return `Enter the code from the test inbox into "${t(step.target)}"`;
  }
}
