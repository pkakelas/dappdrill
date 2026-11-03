import { z } from "zod";
import { ChainConfig } from "./chains.js";
import { EdgeCaseId, DEFAULT_EDGE_CASES } from "./edge-cases.js";
import { Flow, Variation, WalletProfileId } from "./flow.js";
import { ConsoleEntry, Issue, RpcLogEntry } from "./issues.js";
import { SigningReview, WalletRequest } from "./signing.js";

/** Everything the engine needs to drill an app. No database involved. */
export const DrillTarget = z.object({
  url: z.string().url(),
  /** Leave empty to auto-detect from the site's RPC traffic. */
  chains: z.array(ChainConfig).default([]),
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

export const ScanOptions = z.object({
  maxMinutes: z.number().default(15),
  maxFlows: z.number().int().default(8),
  /** Extra plain-English hints for the explorer ("there's a referral flow at /invite"). */
  hints: z.string().optional(),
  /** Flows saved by earlier scans: re-recording one under its name updates it instead of adding a copy. */
  knownFlows: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
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

/** One flow under one edge case (one cell of the report matrix). */
export const FlowRun = z.object({
  id: z.string(),
  flowId: z.string(),
  edgeCase: EdgeCaseId,
  variationId: z.string().optional(),
  /** pass: worked; issue: worked but we found problems; fail: flow broke; error: our side failed; skipped: not applicable. */
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
export type FlowRun = z.infer<typeof FlowRun>;

export const ScanStage = z.enum(["map", "flows", "edge-cases", "signing"]);
export type ScanStage = z.infer<typeof ScanStage>;

export const SCAN_STAGE_LABEL: Record<ScanStage, string> = {
  map: "Map pages",
  flows: "Find and run flows",
  "edge-cases": "Wallet edge cases",
  signing: "Signing review",
};

export const ScanReport = z.object({
  url: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  chains: z.array(ChainConfig),
  pages: z.array(z.object({ url: z.string(), title: z.string().optional() })).default([]),
  flows: z.array(Flow),
  runs: z.array(FlowRun),
  issues: z.array(Issue),
  signingReviews: z.array(SigningReview),
  /** Model usage cost for this scan (USD, estimated). */
  costUsd: z.number().default(0),
  stoppedEarly: z.boolean().default(false),
  /** Set when a bot check stopped the exploration. */
  blocked: Blocked.optional(),
});
export type ScanReport = z.infer<typeof ScanReport>;

export type FlowLiveStatus = "queued" | "running" | "tested" | "issue" | "failed";

/** Streamed while a scan or replay runs. The worker stores them; the CLI prints them. */
export type DrillEvent =
  | { type: "stage"; stage: ScanStage; status: "running" | "done"; progress: number }
  | { type: "log"; level: "info" | "warn" | "error"; message: string; at: string }
  | { type: "frame"; path: string; url: string; at: string }
  | { type: "chains"; chains: ChainConfig[] }
  | { type: "page"; url: string; title?: string }
  | { type: "flow"; flow: Flow }
  | { type: "flow-status"; flowId: string; status: FlowLiveStatus }
  | { type: "wallet-request"; request: WalletRequest }
  | { type: "signing-review"; review: SigningReview }
  | { type: "issue"; issue: Issue }
  | { type: "run"; run: FlowRun }
  | { type: "cost"; usd: number }
  | { type: "blocked"; blocked: Blocked };

export type DrillEventSink = (event: DrillEvent) => void | Promise<void>;

export function nowIso(): string {
  return new Date().toISOString();
}
