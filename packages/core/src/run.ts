import { z } from "zod";
import { ChainConfig } from "./chains.js";
import { EdgeCaseId, DEFAULT_EDGE_CASES } from "./edge-cases.js";
import type { ExploreState } from "./explore.js";
import { ReplayScript, Variation, WalletProfileId } from "./script.js";
import { ConsoleEntry, Issue, RpcLogEntry } from "./issues.js";
import { SigningReview, WalletRequest } from "./signing.js";

/**
 * A request answered without the network. `url` matches the full URL; `*` matches anything,
 * and the query string is ignored unless the pattern has one.
 */
export const FixedResponse = z.object({
  url: z.string().min(1),
  status: z.number().int().min(100).max(599).default(200),
  body: z.string(),
  /** Defaults to JSON when the body parses as JSON, else plain text. */
  contentType: z.string().optional(),
});
export type FixedResponse = z.infer<typeof FixedResponse>;

/** Everything the engine needs to drill an app. No database involved. */
export const DrillTarget = z.object({
  url: z.string().url(),
  /** Leave empty to auto-detect from the site's RPC traffic. */
  chains: z.array(ChainConfig).default([]),
  /** Chains earlier scans saw the app ask for; added to the detected ones when `chains` is empty. */
  learnedChains: z.array(ChainConfig).default([]),
  wallets: z.array(WalletProfileId).default(["metamask"]),
  edgeCases: z.array(EdgeCaseId).default(DEFAULT_EDGE_CASES),
  /** Hex private keys for test accounts A and B. Generated if missing. */
  accounts: z.object({ A: z.string(), B: z.string() }).optional(),
  /** A funded testnet key for chains that can't be forked (live mode). */
  liveKey: z.string().optional(),
  /** Live mode refuses mainnet chain IDs unless this is set. */
  allowMainnetLive: z.boolean().default(false),
  /** Disposable inbox for email-code logins (embedded wallets). */
  inbox: z.object({ address: z.string(), password: z.string() }).optional(),
  /** ERC-20 balances the test accounts get on forked chains; amount in whole tokens ("1000"). */
  tokens: z.array(z.object({ chainId: z.number().int(), address: z.string(), amount: z.string() })).default([]),
  /** Scripts run in every page after the wallet is injected and before the dApp's own code. */
  initScripts: z.array(z.string()).default([]),
  /**
   * HTTP headers sent only to the app's own site (its domain and subdomains), never to RPCs or
   * third parties. For the secret an owner's bot-protection rule lets through (a Cloudflare skip
   * rule, Vercel's x-vercel-protection-bypass).
   */
  headers: z.record(z.string(), z.string()).default({}),
  /** localStorage entries set on the app's own origin before its code runs: a fork mode or feature flag the app reads at startup. */
  storage: z.record(z.string(), z.string()).default({}),
  /** Requests answered with a fixed body instead of the network: a version check, a flags file, a backend that disagrees with the fork. */
  responses: z.array(FixedResponse).default([]),
});
export type DrillTarget = z.infer<typeof DrillTarget>;

/** A CAPTCHA or bot check that stopped DappDrill. */
export const Blocked = z.object({
  /** "Cloudflare", "hCaptcha"…; missing when we can't tell. */
  provider: z.string().optional(),
  reason: z.string(),
  url: z.string(),
});
export type Blocked = z.infer<typeof Blocked>;

/** A chain the app asked the wallet to add that the run couldn't provide. */
export const MissingChain = z.object({
  chainId: z.number().int(),
  name: z.string().optional(),
  /** The RPC the app offered for it. */
  rpcUrl: z.string().optional(),
  reason: z.string(),
});
export type MissingChain = z.infer<typeof MissingChain>;

/**
 * Why a scan had nothing (or too little) to test: the app's data never loaded, or
 * it needed a chain the test wallet couldn't use.
 */
export const Stalled = z.object({
  /** Chains the app needed that the wallet couldn't add; exploring stops when one shows up. */
  chains: z.array(MissingChain).default([]),
  /** Hosts other than RPCs whose requests from the page failed or never answered. */
  backends: z
    .array(z.object({ host: z.string(), failed: z.number().int(), hung: z.number().int(), statuses: z.array(z.number().int()).default([]) }))
    .default([]),
  /** The fork's failed reads per chain, with the cause when the upstream error says it. */
  rpc: z.array(z.object({ chainId: z.number().int(), errors: z.number().int(), cause: z.enum(["rate-limited", "pruned", "timed-out"]).optional(), sample: z.string() })).default([]),
});
export type Stalled = z.infer<typeof Stalled>;

/**
 * Why a planned test couldn't be recorded: the app misbehaved, the test setup can't do it
 * (no funds, a rate limit, no key for the chain), or the agent couldn't work out how.
 */
export const FailCause = z.enum(["app", "setup", "unsure"]);
export type FailCause = z.infer<typeof FailCause>;

/** A test the explorer planned, and what became of it. */
export const PlanItem = z.object({
  name: z.string(),
  /** 1 happy path, 2 variant, 3 unusual case. */
  level: z.number().int(),
  why: z.string(),
  how: z.string(),
  startPath: z.string(),
  dependsOn: z.array(z.string()).default([]),
  outcome: z.enum(["recorded", "failed", "skipped", "not reached"]),
  /** Why it failed or wasn't recorded. */
  note: z.string().optional(),
  cause: FailCause.optional(),
  testId: z.string().optional(),
});
export type PlanItem = z.infer<typeof PlanItem>;

/** What the explorer understood about the app and the tests it planned, up to the scan's depth. */
export const ScanPlan = z.object({
  profile: z.string(),
  persona: z.string(),
  items: z.array(PlanItem),
});
export type ScanPlan = z.infer<typeof ScanPlan>;

export const ScanOptions = z.object({
  maxMinutes: z.number().default(60),
  maxTests: z.number().int().default(20),
  /** How deep the explorer goes: 1 happy paths, 2 variants, 3 unusual cases. Shallower levels are recorded first. */
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** Extra plain-English hints for the explorer ("there's a referral page at /invite"). */
  hints: z.string().optional(),
  /** Planned tests the user doesn't want tested, by name. */
  skipTests: z.array(z.string()).default([]),
  /** Tests saved by earlier scans: re-recording one under its name updates it instead of adding a copy. */
  knownTests: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  headless: z.boolean().default(true),
  /** Directory the engine writes videos, screenshots and traces into. */
  artifactsDir: z.string(),
  /** Previously accepted signing reviews, keyed by fingerprint. */
  baselines: z.record(z.string(), SigningReview).default({}),
});
export type ScanOptions = z.input<typeof ScanOptions>;

export const ReplayOptions = z.object({
  edgeCases: z.array(EdgeCaseId).default(["happy"]),
  variation: Variation.optional(),
  headless: z.boolean().default(true),
  artifactsDir: z.string(),
  baselines: z.record(z.string(), SigningReview).default({}),
  /** Record video (on by default; CI may turn it off for speed). */
  video: z.boolean().default(true),
});
export type ReplayOptions = z.input<typeof ReplayOptions>;

export const StepResult = z.object({
  index: z.number().int(),
  status: z.enum(["pass", "fail", "skipped"]),
  durationMs: z.number(),
  error: z.string().optional(),
  screenshot: z.string().optional(),
  walletRequestId: z.string().optional(),
});
export type StepResult = z.infer<typeof StepResult>;

export const RunStatus = z.enum(["pass", "issue", "fail", "error", "skipped"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** One test under one edge case (one cell of the report matrix). */
export const ConditionRun = z.object({
  id: z.string(),
  testId: z.string(),
  edgeCase: EdgeCaseId,
  variationId: z.string().optional(),
  /** pass: worked; issue: worked but we found problems; fail: test broke; error: our side failed; skipped: not applicable. */
  status: RunStatus,
  /** Why it was skipped / what failed, plainly. */
  reason: z.string().optional(),
  steps: z.array(StepResult).default([]),
  walletRequests: z.array(WalletRequest).default([]),
  signingReviewIds: z.array(z.string()).default([]),
  issueIds: z.array(z.string()).default([]),
  console: z.array(ConsoleEntry).default([]),
  rpc: z.array(RpcLogEntry).default([]),
  video: z.string().optional(),
  trace: z.string().optional(),
  finalScreenshot: z.string().optional(),
  forkBlocks: z.record(z.string(), z.string()).default({}),
  mode: z.enum(["fork", "live"]).default("fork"),
  startedAt: z.string(),
  finishedAt: z.string(),
});
export type ConditionRun = z.infer<typeof ConditionRun>;

export const ScanStage = z.enum(["map", "tests", "edge-cases", "signing"]);
export type ScanStage = z.infer<typeof ScanStage>;

export const SCAN_STAGE_LABEL: Record<ScanStage, string> = {
  map: "Map pages",
  tests: "Find and run tests",
  "edge-cases": "Wallet edge cases",
  signing: "Signing review",
};

export const ScanReport = z.object({
  url: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  chains: z.array(ChainConfig),
  pages: z.array(z.object({ url: z.string(), title: z.string().optional() })).default([]),
  scripts: z.array(ReplayScript),
  runs: z.array(ConditionRun),
  issues: z.array(Issue),
  signingReviews: z.array(SigningReview),
  /** Model usage cost for this scan (USD, estimated). */
  costUsd: z.number().default(0),
  stoppedEarly: z.boolean().default(false),
  /** Set when a bot check stopped the exploration. */
  blocked: Blocked.optional(),
  /** Set when no tests were found because the app's data never loaded. */
  stalled: Stalled.optional(),
  plan: ScanPlan.optional(),
});
export type ScanReport = z.infer<typeof ScanReport>;

export type TestLiveStatus = "queued" | "running" | "tested" | "issue" | "failed";

/** Streamed while a scan or replay runs. The worker stores them; the CLI prints them. */
export type DrillEvent =
  | { type: "stage"; stage: ScanStage; status: "running" | "done"; progress: number }
  | { type: "log"; level: "info" | "warn" | "error"; message: string; at: string }
  | { type: "frame"; path: string; url: string; at: string }
  | { type: "chains"; chains: ChainConfig[] }
  | { type: "page"; url: string; title?: string }
  | { type: "script"; script: ReplayScript }
  | { type: "test-status"; testId: string; status: TestLiveStatus }
  | { type: "wallet-request"; request: WalletRequest }
  | { type: "signing-review"; review: SigningReview }
  | { type: "issue"; issue: Issue }
  | { type: "run"; run: ConditionRun }
  | { type: "cost"; usd: number }
  | { type: "blocked"; blocked: Blocked }
  | { type: "stalled"; stalled: Stalled }
  | { type: "plan"; plan: ScanPlan }
  | { type: "explore"; state: ExploreState };

export type DrillEventSink = (event: DrillEvent) => void | Promise<void>;

export function nowIso(): string {
  return new Date().toISOString();
}
