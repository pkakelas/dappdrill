import { z } from "zod";
import { EdgeCaseId } from "./edge-cases.js";
import { Step } from "./flow.js";
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
  /** Text that proved the expected result last time; checked before asking a model. */
  proof: z.string().optional(),
  /** An unhappy path: the base test's steps under a wallet or network condition. */
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
  /** Problems an unhappy path found (a stuck button, a missing error). */
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

/** One group of tests around a thing users do, with its happy path. */
export const FlowDraft = z.object({
  name: z.string().describe("What the user does, 2-4 words, e.g. 'Trade perps'"),
  test: TestDraft,
});
export type FlowDraft = z.infer<typeof FlowDraft>;

/** Unhappy paths we offer, in the order shown. `default` ones are pre-selected. */
export const CONDITIONS: { id: EdgeCaseId; name: string; expected: string; default: boolean }[] = [
  { id: "reject", name: "Rejected in wallet", expected: "The app shows that the request was rejected and lets the user try again.", default: true },
  { id: "slow-rpc", name: "Slow RPC", expected: "The app keeps working, just slower, and shows that it is loading.", default: true },
  { id: "wrong-network", name: "Wrong network", expected: "The app notices the wrong network and asks the wallet to switch before sending anything.", default: true },
  { id: "low-gas", name: "Not enough gas", expected: "The app tells the user there isn't enough ETH for gas and lets them try again.", default: true },
  { id: "switch-account", name: "Account switched", expected: "The app uses the newly selected account for everything that follows.", default: false },
  { id: "failing-rpc", name: "Failing RPC", expected: "The app retries, or shows a clear error, when an RPC call fails.", default: false },
  { id: "reload-mid-flow", name: "Reload while pending", expected: "After a reload the app shows the pending transaction and then its confirmation.", default: false },
  { id: "two-wallets", name: "Two wallets installed", expected: "The app uses the wallet the user picked when two are installed.", default: false },
  { id: "unknown-chain", name: "Chain unknown to wallet", expected: "The app adds the chain to the wallet when the wallet doesn't know it yet.", default: false },
  { id: "speed-up", name: "Sped-up transaction", expected: "The app notices the replaced transaction and shows it as confirmed.", default: false },
];

export function conditionInfo(id: EdgeCaseId) {
  return CONDITIONS.find((c) => c.id === id);
}
