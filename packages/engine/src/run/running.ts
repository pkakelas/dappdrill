/** One test in progress: the open session and what has been gathered so far. */
import { sentence, type Action, type Check, type LineResult, type SigningReview, type WalletRequest } from "@dappdrill/core";
import type { EngineSession } from "../browser/session.js";
import type { Env } from "../pipeline/env.js";
import { debug } from "../pipeline/session.js";
import type { Hex } from "../types.js";
import type { Reading } from "./code-check.js";

export interface Running {
  env: Env;
  session: EngineSession;
  /** What is being run: a test, or the suite's setup. */
  name: string;
  goal: string;
  steps: (Action | Check)[];
  /** Wallet requests before this index were made before this began. */
  since: number;
  /** When the latest action began, or this did when there has been none (Date.now()). */
  acted: number;
  reviews: SigningReview[];
  /** Figures as they stood before the first action, for the checks on how far they moved. */
  before: Map<string, Reading>;
  /** What is known about the app, for whoever does an action. Checks are decided without it. */
  notes: string[];
  /** Why a wallet request must not be approved by a model, when it mustn't. */
  refuseApprove?: (request: WalletRequest) => string | undefined;
  signal?: AbortSignal;
}

/** How a line went, without the time and the cost: the walker adds those. */
export type Went = Pick<LineResult, "status" | "by"> & Partial<Pick<LineResult, "model" | "note" | "did" | "redone" | "recorded">>;

/** Reviews a request before the wallet approves it. A review that can't be made is told, not fatal. */
export async function reviewRequest(run: Running, request: WalletRequest): Promise<void> {
  const { session, env } = run;
  const screenshot = await session.screenshot(`sign-${request.id}`);
  const review = await env.reviewer
    .review({ request, chains: env.chains, ui: { buttonLabel: session.lastClickedLabel(), pageUrl: session.page.url(), screenshot }, baselines: {}, artifactsDir: session.artifactsDir })
    .catch((e) => debug(`signing review failed: ${e instanceof Error ? e.message : e}`));
  if (review) run.reviews.push(review);
}

/** What the wallet was asked to sign or send since this began. */
export const signRequests = (run: Running): WalletRequest[] => run.session.wallet.requests().slice(run.since).filter((r) => r.kind === "sign");

/** The hash of the transaction a request sent, when it was approved and sent one. */
export function sentHash(r: WalletRequest): Hex | undefined {
  return r.outcome === "approved" && typeof r.result === "string" && /^0x[0-9a-f]{64}$/i.test(r.result) ? (r.result as Hex) : undefined;
}

/** A line for a model to read, numbered, with the checks marked as someone else's. */
export const numbered = (line: Action | Check, i: number): string => `${i + 1}. ${line.type === "check" ? "(check) " : ""}${sentence(line)}`;

/** The lines of what is being run, one each, for a model: which are done and which one is its own. */
export function lines(run: Running, now: number): string[] {
  return run.steps.map((s, i) => `${numbered(s, i)}${i < now ? "  (done)" : i === now ? "  ← this one" : ""}`);
}
