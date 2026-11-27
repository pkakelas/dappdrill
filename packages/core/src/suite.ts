/**
 * A test is a flat list of actions and checks. The code of a line is the test, and its sentence says
 * what the code does. An action's code is a recording replayed in the browser; a check's code is one
 * assertion about the page, the wallet or the chain. A run does only the code and never calls a model.
 * A line that has no code yet (`by: "llm"`, or a code action whose recording is empty) can't be run:
 * it is written as code while the test is made or repaired, which is when models are used.
 */
import { z } from "zod";
import { Fund } from "./run.js";
import { SigningReview } from "./signing.js";
import { Step } from "./script.js";

/** One thing done in the browser or the wallet: open, click, type, choose, press, wait, approve or reject. */
export const BrowserAction = Step;
export type BrowserAction = Step;

export const CodeAction = z.object({
  type: z.literal("action"),
  by: z.literal("code"),
  /** What is done, in plain words. Making and repairing do it from this sentence to record `run`. */
  do: z.string().min(1),
  /** The recording a run replays. Empty until making or repairing has recorded it; a run can't do the line till then. */
  run: z.array(BrowserAction).default([]),
});
export type CodeAction = z.infer<typeof CodeAction>;

/** An action not written as code yet, and never recorded: a run can't do it. Repairing makes it a code action. */
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
 * Where on the page a check reads. `row`: only inside the row that holds this text (a line of a table or a
 * list: "{{price}}", "Apple"). `dialog`: only inside the dialog or menu that is open. Neither: the whole page.
 */
const where = {
  row: z.string().min(1).optional(),
  dialog: z.boolean().optional(),
};

/**
 * How long a check keeps looking, in seconds. The whole assertion is read again every quarter of a second
 * until it passes or the time is up, and the last reading is what the line says. Left out, each kind has its
 * own: 5 for shows, said and figures, 3 for button, 20 for changes, 15 for mined, and none for the rest
 * (hides, url, signed, not-signed, no-error are read once). A group waits as long as the longest of its parts.
 */
const wait = z.number().min(0).max(120).optional();

/** A number of the test's own: 100, or a value of the run written "{{amount}}". */
const Stated = z.union([z.number(), z.string().regex(/^-?(\{\{\w+\}\}|\d+(\.\d+)?)$/, 'a number, or a value of the run like "{{amount}}"')]);

/**
 * A figure read off the page, one of:
 * - `label`: the first number after this label, as the page writes it ("Cash"). With `row`, in that row; with `dialog`, in the open dialog.
 * - `column` and `row`: the number under this column heading, in the row that holds the text.
 * - `column` and `all`: every row's number under this column heading added up ("sum"), or how many rows the table has ("count").
 * - `row` and `all: "count"`, with no label or column: how many rows hold the text.
 */
export const PageFigure = z
  .object({
    label: z.string().min(1).optional(),
    column: z.string().min(1).optional(),
    all: z.enum(["sum", "count"]).optional(),
    ...where,
  })
  .refine((f) => (f.label ? !f.column && !f.all : f.column ? Boolean(f.row) !== Boolean(f.all) : Boolean(f.row) && f.all === "count"), {
    message: "A figure is a label, a column with a row, a column with all, or a row with all: count",
  });
export type PageFigure = z.infer<typeof PageFigure>;

const Term = z.union([Stated, PageFigure]);
/** One side of a comparison: a figure, or several added up or multiplied together. */
const Side = z.union([z.object({ add: z.array(Term).min(2) }), z.object({ multiply: z.array(Term).min(2) }), Term]);
export type FigureSide = z.infer<typeof Side>;

/** A text on the page now, in one place or read across elements the way a person reads them. */
const Shows = z.object({ kind: z.literal("shows"), text: z.string().min(1), ...where, wait });
/** The text isn't on the page. In a row that isn't there, nothing is, so that passes too. */
const Hides = z.object({ kind: z.literal("hides"), text: z.string().min(1), ...where, wait });
/** A text the page showed since the latest action began, still there or not (a notice that fades). */
const Said = z.object({ kind: z.literal("said"), text: z.string().min(1), wait });
const Url = z.object({ kind: z.literal("url"), contains: z.string().min(1), wait });
/** A button, a link or another control with exactly this name is offered and can be used, or is greyed out. */
const Button = z.object({ kind: z.literal("button"), name: z.string().min(1), is: z.enum(["enabled", "disabled"]), ...where, wait });
/** Only what the wallet was asked since the latest action began, not everything since the test began. */
const latest = z.boolean().optional();
/**
 * The wallet was asked to sign something that holds this: a function name, an address, an amount in the
 * token's units. `was` also says how the request ended.
 */
const Signed = z.object({ kind: z.literal("signed"), holds: z.string().min(1), was: z.enum(["approved", "rejected"]).optional(), latest, wait });
/** The wallet was asked nothing, or nothing that holds this. */
const NotSigned = z.object({ kind: z.literal("not-signed"), holds: z.string().min(1).optional(), latest, wait });
/** The latest transaction, or the latest that holds this, was mined and didn't revert. */
const Mined = z.object({ kind: z.literal("mined"), holds: z.string().min(1).optional(), wait });
/** The figure under a label moved by this much since the test began. */
const Changes = z.object({
  kind: z.literal("changes"),
  /** The label the figure stands under, as the page writes it ("Wallet balance"). */
  figure: z.string().min(1),
  /** Signed: -100 for a fall of 100. A value of the run's own is written with its sign: "-{{amount}}". */
  by: Stated,
  wait,
});
/**
 * Two figures compared: `left` is equal to, at most, at least, less than or more than `right`.
 * `within` is how far off still counts, as a number (0.02) or a share of the right side ("2%"); it widens
 * equal, at-most and at-least. Left out, equal allows one unit of the last digit the page shows.
 * Unsure, not failed, when a figure it needs isn't on the page.
 */
const Figures = z.object({
  kind: z.literal("figures"),
  left: Side,
  is: z.enum(["equal", "at-most", "at-least", "less", "more"]),
  right: Side,
  within: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d+)?%$/, 'a number, or a share like "2%"')]).optional(),
  wait,
});
/**
 * Nothing a user shouldn't be shown is on the page or was said since the latest action began: an error
 * code, a stack trace, an exception's name, raw JSON, "[object Object]", "undefined" or "NaN" where a value belongs.
 */
const NoError = z.object({ kind: z.literal("no-error"), ...where, wait });

const plain = [Shows, Hides, Said, Url, Button, Signed, NotSigned, Mined, Figures, NoError] as const;
/** Several outcomes any of which is fine ("Cancelled, or gone from the list"). */
const Any = z.object({ kind: z.literal("any"), of: z.array(z.discriminatedUnion("kind", [...plain, Changes])).min(2), wait });
/** Several things that must all hold at the same moment. A part may itself be an `any`. */
const All = z.object({ kind: z.literal("all"), of: z.array(z.discriminatedUnion("kind", [...plain, Changes, Any])).min(2), wait });

/**
 * What code can decide, as data: every kind is something Playwright can read or wait for, and none needs a
 * model. A check that needs several facts is an `all`, one with several good outcomes an `any`.
 */
export const CodeAssert = z.discriminatedUnion("kind", [
  ...plain,
  /** On its own line, `changes` may name the page the figure is on ("/home"), when it isn't where the test is. The check opens it. */
  Changes.extend({ on: z.string().regex(/^\//, "on is the path of a page on the app, like /home, not a label").optional() }),
  Any,
  All,
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

/** A check not written as code yet: a run can't decide it. Repairing writes it as a code check, from what the page showed. */
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

/** A line a run can do, since a run calls no model: an action with a recording, a check with its code. */
export const isCode = (line: Action | Check): boolean => line.by === "code" && (line.type === "check" || line.run.length > 0);

/** A number between two bounds, written with a fixed count of decimals ("287.40"). */
export const RunValue = z.object({ from: z.number(), to: z.number(), decimals: z.number().int().min(0).max(8).default(2) });
export type RunValue = z.infer<typeof RunValue>;

export const Test = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** What a user is after, in a sentence. The models read it; nothing is judged against it. */
  goal: z.string().min(1),
  /** The heading it is listed under with the tests like it: what a user is doing there, in a few words. Nothing in a run reads it. */
  group: z.string().min(1).max(40).optional(),
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
  /**
   * What this test's new account starts with, in place of what the app sends every new account. Empty
   * for a test that needs an account holding nothing. Left out, the app's own list is used. A kept
   * account holds what it holds, so this says nothing there.
   */
  fund: z.array(Fund).optional(),
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
  /** The app's owner, the look over the app, the maker of a kept test, or the maker of a test that wasn't kept. */
  from: z.enum(["owner", "look", "maker", "unkept"]).default("owner"),
});
export type Note = z.infer<typeof Note>;

/** A note as the models read it. One from a test that wasn't kept says so: the attempt may have gone the wrong way. */
export const noteText = (n: Note) => (n.from === "unkept" ? `${n.text} (learned while making a test that wasn't kept, so it may be wrong)` : n.text);

/** The notes with new ones added. One already there is not added again, and a kept test learning one a test that wasn't kept learned makes it sure. */
export function withNotes(notes: Note[], texts: string[], from: Note["from"]): Note[] {
  const known = new Set(notes.map((n) => n.text));
  const sure = from === "unkept" ? new Set<string>() : new Set(texts);
  return [...notes.map((n) => (n.from === "unkept" && sure.has(n.text) ? { ...n, from } : n)), ...texts.filter((text, i) => !known.has(text) && texts.indexOf(text) === i).map((text) => ({ text, from }))];
}

/** The tests of one app, and what is done once before them so each starts as a user who is already in. */
export const Suite = z.object({
  /** Done once in a browser of its own: connect, sign in, get funds. Every test starts from where it ends. */
  setup: z.object({ startPath: z.string().default("/"), steps: z.array(Action).min(1) }).optional(),
  /**
   * Done before each test on a kept account, from where the setup ends: put the account back to where a test
   * expects it (cancel every open order, close every position). Not used with new accounts, which start clean.
   */
  reset: z.object({ startPath: z.string().default("/"), steps: z.array(Action).min(1) }).optional(),
  notes: z.array(Note).default([]),
  /**
   * What may be approved in the wallet. "setup": only while setting up (signing in), nothing in a
   * test, for an app on a chain with real funds. "refused": nothing at all, for an app that makes
   * an account of whoever signs in. Rejecting a request is always done.
   */
  signing: z.enum(["allowed", "setup", "refused"]).default("allowed"),
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
  /** The reset's lines, when the suite has one: what was done to the kept account before this test. */
  reset: z.array(LineResult).default([]),
  /**
   * It stopped on a line that isn't written as code yet, or whose recording no longer fits the page. A run
   * uses no model, so it couldn't go on: repairing the test may put it right.
   */
  repairable: z.boolean().default(false),
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
 * The test with what a making or repairing run recorded written in: every action a model did, in the test
 * or in its cleanup, becomes a code action with the browser actions it took, and the run's values put back
 * under their names. A recording that lost a value its sentence names isn't kept, since it would type the
 * same number on every run.
 */
export function withRecordings(test: Test, result: TestResult): Test {
  const values = Object.entries(result.values).filter(([name]) => name in test.values);
  // Only inside text (what was typed, a name), never a number of the recording's own (a row's position). Not
  // inside a longer number: 20.00 isn't put back into 120.005. A short whole number ("3") is put back only
  // where it is the whole text, since "Step 3" or "3 of 5" means something else.
  const named = (text: string) => {
    for (const [name, value] of values) {
      if (/^\d{1,2}$/.test(value)) text = text === value ? `{{${name}}}` : text;
      else text = text.replace(new RegExp(`(?<![\\d.])${value.replace(/\./g, "\\.")}(?!\\d)`, "g"), `{{${name}}}`);
    }
    return text;
  };
  const recorded = <L extends Action | Check>(line: L, went: LineResult | undefined): L | CodeAction => {
    if (line.type !== "action" || went?.status !== "pass" || !went.recorded?.length) return line;
    const written = JSON.stringify(went.recorded, (_key, v: unknown) => (typeof v === "string" ? named(v) : v));
    const lost = [...line.do.matchAll(NAMED)].some(([whole, name]) => name! in test.values && !written.includes(whole));
    return lost ? line : { type: "action", by: "code", do: line.do, run: z.array(BrowserAction).parse(JSON.parse(written)) };
  };
  return { ...test, steps: test.steps.map((line, i) => recorded(line, result.steps[i])), cleanup: test.cleanup.map((line, i) => recorded(line, result.cleanup[i])) };
}

/** Where a path on the app opens. The app URL's query (`?chain=…`, a flag) stays unless the path has its own. */
export function urlOnApp(path: string, appUrl: string): string {
  const app = new URL(appUrl);
  const url = new URL(path, app);
  if (!url.search && url.origin === app.origin) url.search = app.search;
  return url.href;
}
