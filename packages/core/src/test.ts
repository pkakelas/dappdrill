import { z } from "zod";
import { EdgeCaseId } from "./edge-cases.js";
import { Step } from "./script.js";
import { ConsoleEntry, Issue } from "./issues.js";
import { SigningReview, WalletRequest } from "./signing.js";

/**
 * Tests are plain English: a goal, an expected result and short steps. The
 * browser actions that carried out a step last time are cached on it and
 * replayed without a model while they still work.
 */
export const TestStep = z.object({
  text: z.string().min(1),
  /** Recorded on the last run that passed this step. Empty: the step needed no action. */
  actions: z.array(Step).optional(),
});
export type TestStep = z.infer<typeof TestStep>;

/** New steps from text, keeping the cached actions of steps whose text didn't change. */
export function keepActions(texts: string[], old: TestStep[]): TestStep[] {
  const byText = new Map(old.map((s) => [norm(s.text), s.actions]));
  return texts.map((text) => {
    const actions = byText.get(norm(text));
    return actions ? { text, actions } : { text };
  });
}

/** Where a path on the app opens. The app URL's query (`?chain=…`, a fork flag) stays unless the path has its own. */
export function urlOnApp(path: string, appUrl: string): string {
  const app = new URL(appUrl);
  const url = new URL(path, app);
  if (!url.search && url.origin === app.origin) url.search = app.search;
  return url.href;
}

/** Whether a step's recorded actions include handling a signature request. */
export function stepSigns(step: TestStep): boolean {
  return step.actions?.some((a) => a.kind === "wallet") ?? false;
}

/**
 * Whether a test asks the wallet to sign, from what its runs recorded. Connecting
 * doesn't count: it's approved automatically and there's nothing to reject or pay for.
 * "unknown" until every step has run, since the wallet may come after where it stopped.
 */
export function walletUse(steps: TestStep[]): "signs" | "none" | "unknown" {
  if (steps.some(stepSigns)) return "signs";
  return steps.length > 0 && steps.every((s) => s.actions) ? "none" : "unknown";
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]$/, "");
}

/** What the engine needs to run one test. */
export const TestSpec = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  expected: z.string(),
  /** Same-origin path the test opens first. */
  startPath: z.string().default("/"),
  steps: z.array(TestStep),
  /** Unused: every run asks the judge. Kept until the column goes in a migration. */
  proof: z.string().optional(),
  /** A condition row: the base test's steps under a wallet or network condition. */
  condition: EdgeCaseId.optional(),
});
export type TestSpec = z.infer<typeof TestSpec>;

/** A test as written by a person or a model, before anything ran. */
export const TestDraft = z.object({
  name: z.string().describe("Short name, e.g. 'Market buy on a perp'"),
  goal: z.string().describe("One sentence: what the user does and where, e.g. 'Place a small market buy on a perpetual market from Explore and confirm it shows up in the account's orders.'"),
  expected: z.string().describe("One sentence: what is visible on the page when it worked"),
  startPath: z.string().describe("Same-origin path the test starts on, e.g. /explore"),
  steps: z.array(z.string()).min(1).max(10).describe("3-8 imperative steps of 3-7 words each, e.g. 'Connect the wallet', 'Open the ETH market'"),
});
export type TestDraft = z.infer<typeof TestDraft>;

/**
 * When the app's setup runs. once: one time per run; on forks each test then starts from the
 * state it left (browser storage and chain), on live chains tests share what it left.
 * each: again before every test, for setups that can't be shared.
 */
export const SetupWhen = z.enum(["once", "each"]);
export type SetupWhen = z.infer<typeof SetupWhen>;

export const SETUP_WHEN_LABEL: Record<SetupWhen, string> = { once: "Once per run", each: "Before each test" };

/** Steps every test of the app needs first: sign in, get test funds. */
export const AppSetup = z.object({
  startPath: z.string().default("/"),
  steps: z.array(TestStep).min(1),
  when: SetupWhen.default("once"),
  /** Why `when` was picked, shown next to it. */
  why: z.string().optional(),
});
export type AppSetup = z.infer<typeof AppSetup>;

/** The setup the analysis proposes. */
export const SetupDraft = z.object({
  startPath: z.string().describe("Same-origin path the setup starts on, e.g. /"),
  steps: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("Short imperative steps every test needs first, e.g. 'Sign in with the email code', 'Mint test funds', 'Approve in the wallet'"),
  when: SetupWhen.describe(
    "once: run one time per run (default; also when a step can't be repeated, like a faucet with a limit or an email code). each: run before every test, when tests use up what it gives on a live chain and it is cheap to repeat.",
  ),
  why: z.string().describe("One short sentence on why, e.g. 'The faucet allows one mint a day.'"),
});
export type SetupDraft = z.infer<typeof SetupDraft>;

export const StepStatus = z.enum(["pending", "running", "pass", "fail", "skipped"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const TestStepResult = z.object({
  status: StepStatus,
  /** cache: replayed the recorded actions; agent: the model did the step. */
  via: z.enum(["cache", "agent"]).optional(),
  /** What happened, one short line per action. */
  did: z.array(z.string()).default([]),
  /** Why it failed, or what the model noticed. */
  note: z.string().optional(),
  screenshot: z.string().optional(),
  durationMs: z.number().default(0),
});
export type TestStepResult = z.infer<typeof TestStepResult>;

export const TestRunStatus = z.enum(["queued", "running", "pass", "fail", "error", "skipped", "stopped"]);
export type TestRunStatus = z.infer<typeof TestRunStatus>;

/** What the app's setup did before this test. */
export const SetupRunResult = z.object({
  ok: z.boolean(),
  steps: z.array(TestStepResult).default([]),
  when: SetupWhen,
  /** It ran before an earlier test of this run; this test started from the state it left. */
  reused: z.boolean().default(false),
  /** A chain is live, so this test also started from whatever earlier tests left. */
  shared: z.boolean().default(false),
});
export type SetupRunResult = z.infer<typeof SetupRunResult>;

export const TestRunResult = z.object({
  setup: SetupRunResult.optional(),
  steps: z.array(TestStepResult).default([]),
  /** Did the expected result show, and how we know. */
  verdict: z.object({ ok: z.boolean(), reason: z.string() }).optional(),
  /** What went wrong, in one plain sentence. */
  failure: z.string().optional(),
  walletRequests: z.array(WalletRequest).default([]),
  signingReviews: z.array(SigningReview).default([]),
  /** Problems a condition found (a stuck button, a missing error). */
  issues: z.array(Issue).default([]),
  console: z.array(ConsoleEntry).default([]),
  video: z.string().optional(),
  finalScreenshot: z.string().optional(),
  costUsd: z.number().default(0),
});
export type TestRunResult = z.infer<typeof TestRunResult>;

/** What the analysis learned about the app; the fast model runs tests with it. */
export const AppMap = z.object({
  summary: z.string().describe("Two sentences: what the app is and what a user does with it"),
  pages: z.array(z.object({ path: z.string(), purpose: z.string() })),
});
export type AppMap = z.infer<typeof AppMap>;

/** Something users do that the analysis saw but wrote no steps for: shows under Not tested yet. */
export const TestIdea = TestDraft.pick({ name: true, goal: true });
export type TestIdea = z.infer<typeof TestIdea>;
