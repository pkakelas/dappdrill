/**
 * A test is a flat list of actions and checks, and every line says who does it: code or a model.
 * An action by code is replayed in the browser with no model; an action by a model is done from
 * its sentence. A check by code is a fact about the page, the wallet or the chain; a check by a
 * model is a claim answered yes, no or can't tell by a model that never saw the actions being done.
 */
import { z } from "zod";
import { SigningReview } from "./signing.js";
import { Step } from "./script.js";

/** One thing done in the browser or the wallet: open, click, type, choose, press, wait, approve or reject. */
export const BrowserAction = Step;
export type BrowserAction = Step;

export const CodeAction = z.object({
  type: z.literal("action"),
  by: z.literal("code"),
  /** What is done, in plain words. A model does it from this sentence when `run` stops working. */
  do: z.string().min(1),
  /** Empty until a run has recorded it: a model does it from the sentence and the run hands back what it did. */
  run: z.array(BrowserAction).default([]),
});
export type CodeAction = z.infer<typeof CodeAction>;

export const LlmAction = z.object({
  type: z.literal("action"),
  by: z.literal("llm"),
  /** A concrete instruction: what to do and with which values, not a goal to work out. */
  do: z.string().min(1),
});
export type LlmAction = z.infer<typeof LlmAction>;

export const Action = z.discriminatedUnion("by", [CodeAction, LlmAction]);
export type Action = z.infer<typeof Action>;

/**
 * What code can decide.
 * shows / hides: text on the page now. said: text the page showed since the latest action began,
 * still there or not (a notice that fades). url: the address contains it. button: a button by its name is
 * enabled or disabled. signed: the wallet was asked to sign something that holds this (a function
 * name, an address, an amount in the token's units). not-signed: nothing was asked, or nothing
 * that holds this. mined: the latest transaction, or the latest that holds this, was mined and didn't revert. changes: the figure
 * under a label moved by this much since the test began, read on the page it names.
 */
export const CodeAssert = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shows"), text: z.string().min(1) }),
  z.object({ kind: z.literal("hides"), text: z.string().min(1) }),
  z.object({ kind: z.literal("said"), text: z.string().min(1) }),
  z.object({ kind: z.literal("url"), contains: z.string().min(1) }),
  z.object({ kind: z.literal("button"), name: z.string().min(1), is: z.enum(["enabled", "disabled"]) }),
  z.object({ kind: z.literal("signed"), holds: z.string().min(1) }),
  z.object({ kind: z.literal("not-signed"), holds: z.string().min(1).optional() }),
  z.object({ kind: z.literal("mined"), holds: z.string().min(1).optional() }),
  z.object({
    kind: z.literal("changes"),
    /** The label the figure stands under, as the page writes it ("Wallet balance"). */
    figure: z.string().min(1),
    /** Signed: -100 for a fall of 100. A value of the run's own is written with its sign: "-{{amount}}". */
    by: z.union([z.number(), z.string().regex(/^-?(\{\{\w+\}\}|\d+(\.\d+)?)$/)]),
    /** The page the figure is on, when it isn't where the test is. The check opens it. */
    on: z.string().optional(),
  }),
]);
export type CodeAssert = z.infer<typeof CodeAssert>;

export const CodeCheck = z.object({
  type: z.literal("check"),
  by: z.literal("code"),
  /** The claim in plain words. */
  claim: z.string().min(1),
  expect: CodeAssert,
});
export type CodeCheck = z.infer<typeof CodeCheck>;

export const LlmCheck = z.object({
  type: z.literal("check"),
  by: z.literal("llm"),
  /** One claim about what the page shows or what the wallet was asked, true when the app works. */
  claim: z.string().min(1),
});
export type LlmCheck = z.infer<typeof LlmCheck>;

export const Check = z.discriminatedUnion("by", [CodeCheck, LlmCheck]);
export type Check = z.infer<typeof Check>;

/** A line's own words: what an action does, or what a check claims. */
export const sentence = (line: Action | Check): string => (line.type === "action" ? line.do : line.claim);

/** A number between two bounds, written with a fixed count of decimals ("287.40"). */
export const RunValue = z.object({ from: z.number(), to: z.number(), decimals: z.number().int().min(0).max(8).default(2) });
export type RunValue = z.infer<typeof RunValue>;

export const Test = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** What a user is after, in a sentence. The models read it; nothing is judged against it. */
  goal: z.string().min(1),
  startPath: z.string().default("/"),
  /**
   * Numbers picked afresh on every run and written {{name}} anywhere in the test. On an account
   * that keeps what earlier runs left, a price or an amount of the run's own is how its order is
   * told from theirs.
   */
  values: z.record(z.string(), RunValue).default({}),
  steps: z.array(z.union([Action, Check])).min(1),
  /**
   * Done when the test stopped before its last action, to take back what it had already left on an
   * account that isn't reset. A test that got through its actions has put things back itself.
   */
  cleanup: z.array(Action).default([]),
});
export type Test = z.infer<typeof Test>;

/** The test with this run's values written in, and the values that were picked. */
export function fillValues(test: Test, random: () => number = Math.random): { test: Test; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const [name, v] of Object.entries(test.values)) values[name] = (v.from + random() * (v.to - v.from)).toFixed(v.decimals);
  const written = JSON.stringify(test).replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);
  return { test: Test.parse(JSON.parse(written)), values };
}

/**
 * Something about the app that whoever does an action needs and the page doesn't say ("after a full
 * reload trading has to be enabled again", "never approve a deposit"). Whoever decides a check never reads it.
 */
export const Note = z.object({
  text: z.string().min(1),
  /** The app's owner, the look over the app, or the maker of a test. */
  from: z.enum(["owner", "look", "maker"]).default("owner"),
});
export type Note = z.infer<typeof Note>;

/** The tests of one app, and what is done once before them so each starts as a user who is already in. */
export const Suite = z.object({
  /** Done once in a browser of its own: connect, sign in, get funds. Every test starts from where it ends. */
  setup: z.object({ startPath: z.string().default("/"), steps: z.array(Action).min(1) }).optional(),
  notes: z.array(Note).default([]),
  tests: z.array(Test).default([]),
});
export type Suite = z.infer<typeof Suite>;

/**
 * How a line went. For an action: pass when it was done, fail when the app wouldn't let it be
 * done, unsure when we couldn't do it. For a check: pass, fail, or unsure when it couldn't be told.
 */
export const LineStatus = z.enum(["pass", "fail", "unsure", "skipped"]);
export type LineStatus = z.infer<typeof LineStatus>;

export const LineResult = z.object({
  status: LineStatus,
  /** Who did it in the end. A code action a model had to do says so in `redone`. */
  by: z.enum(["code", "llm"]),
  /** The model that did it or answered, when one did. */
  model: z.string().optional(),
  /** What was found, or what went wrong, in a sentence. */
  note: z.string().default(""),
  /** For an action: what was done in the browser, one line each. */
  did: z.array(z.string()).default([]),
  /** For a code action a model did instead: why the recorded actions stopped working. */
  redone: z.string().optional(),
  /** For a code action a model did: the browser actions it took, to replay from now on. */
  recorded: z.array(BrowserAction).optional(),
  screenshot: z.string().optional(),
  /** What the page read when the line didn't pass, for whoever has to say why. */
  page: z.string().optional(),
  durationMs: z.number().default(0),
  costUsd: z.number().default(0),
});
export type LineResult = z.infer<typeof LineResult>;

/** Passed: every check passed. Failed: a check failed or the app wouldn't let an action be done. Couldn't verify: the rest. */
export const Outcome = z.enum(["passed", "failed", "unverified"]);
export type Outcome = z.infer<typeof Outcome>;

export const OUTCOME_LABEL: Record<Outcome, string> = { passed: "Passed", failed: "Failed", unverified: "Couldn't verify" };

export const TestResult = z.object({
  testId: z.string(),
  outcome: Outcome,
  /** Why it isn't Passed, in a sentence. */
  reason: z.string().optional(),
  /** One per line of the test, in its order. */
  steps: z.array(LineResult),
  /** The values this run picked, by name. */
  values: z.record(z.string(), z.string()).default({}),
  /** The cleanup's lines, when it had to run. */
  cleanup: z.array(LineResult).default([]),
  signingReviews: z.array(SigningReview).default([]),
  /** A failure is run once more before it counts; true when this result is that second run. */
  rerun: z.boolean().default(false),
  /** Why the first run failed, when this is the second. */
  firstReason: z.string().optional(),
  video: z.string().optional(),
  durationMs: z.number(),
  costUsd: z.number(),
});
export type TestResult = z.infer<typeof TestResult>;

export const SuiteResult = z.object({
  /** The setup's lines, when the suite has one. */
  setup: z.array(LineResult).optional(),
  tests: z.array(TestResult),
  durationMs: z.number(),
  costUsd: z.number(),
});
export type SuiteResult = z.infer<typeof SuiteResult>;

/** From the lines to the outcome: any fail is Failed, else anything unsure or left undone is Couldn't verify. */
export function outcomeOf(steps: LineResult[]): Outcome {
  if (steps.some((s) => s.status === "fail")) return "failed";
  return steps.every((s) => s.status === "pass") ? "passed" : "unverified";
}

const NAMED = /\{\{(\w+)\}\}/g;

/**
 * The test with what a run recorded written in: every code action a model did gets the browser
 * actions it took, with the run's values put back under their names. A recording that lost a value
 * its sentence names isn't kept, since it would type the same number on every run.
 */
export function withRecordings(test: Test, result: TestResult): Test {
  const values = Object.entries(result.values).filter(([name]) => name in test.values);
  const steps = test.steps.map((line, i) => {
    const went = result.steps[i];
    if (line.type !== "action" || line.by !== "code" || went?.status !== "pass" || !went.recorded?.length) return line;
    let written = JSON.stringify(went.recorded);
    // Not inside a longer number: 20.00 isn't put back into 120.005.
    for (const [name, value] of values) written = written.replace(new RegExp(`(?<![\\d.])${value.replace(/\./g, "\\.")}(?!\\d)`, "g"), `{{${name}}}`);
    const lost = [...line.do.matchAll(NAMED)].some(([whole, name]) => name! in test.values && !written.includes(whole));
    return lost ? line : { ...line, run: z.array(BrowserAction).parse(JSON.parse(written)) };
  });
  return { ...test, steps };
}
