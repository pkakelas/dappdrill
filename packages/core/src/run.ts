import { z } from "zod";
import { ChainConfig } from "./chains.js";
import { WalletProfileId } from "./script.js";
import type { SigningReview, WalletRequest } from "./signing.js";

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

/** Everything the engine needs to open an app with a test wallet. No database involved. */
export const DrillTarget = z.object({
  url: z.string().url(),
  /** Leave empty to auto-detect from the site's RPC traffic. */
  chains: z.array(ChainConfig).default([]),
  /** Chains earlier runs saw the app ask for; added to the detected ones when `chains` is empty. */
  learnedChains: z.array(ChainConfig).default([]),
  wallets: z.array(WalletProfileId).default(["metamask"]),
  /** Hex private keys for test accounts A and B. Generated if missing. */
  accounts: z.object({ A: z.string(), B: z.string() }).optional(),
  /** A funded testnet key for chains that can't be forked (live mode). */
  liveKey: z.string().optional(),
  /** How to get test funds on a chain that can't be forked, in the owner's words. Without it or a live key, nothing is made on such a chain. */
  funding: z.string().optional(),
  /** Live mode refuses mainnet chain IDs unless this is set. */
  allowMainnetLive: z.boolean().default(false),
  /** Disposable inbox for email-code logins (embedded wallets). */
  inbox: z.object({ address: z.string(), password: z.string() }).optional(),
  /** ERC-20 balances the test accounts get on forked chains; amount in whole tokens ("1000"). */
  tokens: z.array(z.object({ chainId: z.number().int(), address: z.string(), amount: z.string(), symbol: z.string().optional() })).default([]),
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

export const StepResult = z.object({
  index: z.number().int(),
  status: z.enum(["pass", "fail", "skipped"]),
  durationMs: z.number(),
  error: z.string().optional(),
  screenshot: z.string().optional(),
  walletRequestId: z.string().optional(),
});
export type StepResult = z.infer<typeof StepResult>;

/**
 * What a browser session tells its caller while it works. What a run or a make came to is given
 * back through its own callbacks; these are the pictures, the chains, the wallet and the cost.
 */
export type DrillEvent =
  | { type: "log"; level: "info" | "warn" | "error"; message: string; at: string }
  | { type: "frame"; path: string; url: string; at: string }
  | { type: "chains"; chains: ChainConfig[] }
  | { type: "wallet-request"; request: WalletRequest }
  | { type: "signing-review"; review: SigningReview }
  | { type: "cost"; usd: number };

export type DrillEventSink = (event: DrillEvent) => void | Promise<void>;

export function nowIso(): string {
  return new Date().toISOString();
}
