/** One test in progress: the open session and what has been gathered so far. */
import { sentence, type Action, type Check, type BrowserAction, type LineResult, type SigningReview, type WalletRequest } from "@dappdrill/core";
import type { EngineSession } from "../browser/session.js";
import type { Env } from "./env.js";
import { debug } from "./session.js";
import type { Hex } from "../types.js";
import type { Reading } from "./code-check.js";

export interface Running {
  env: Env;
  session: EngineSession;
  /** What is being run: a test, or the suite's setup or reset. */
  name: string;
  goal: string;
  steps: (Action | Check)[];
  /** Wallet requests before this index were made before this began. */
  since: number;
  /** When the latest action began, or this did when there has been none (Date.now()). */
  acted: number;
  /** Wallet requests from this index on were made since the latest action began. Missing before the first action. */
  actedAt?: number;
  reviews: SigningReview[];
  /** Figures as they stood before the first action, for the checks on how far they moved. */
  before: Map<string, Reading>;
  /** What is known about the app, for whoever does an action. Checks are decided without it. */
  notes: string[];
  /** Why a wallet request must not be approved, when it mustn't. */
  refuseApprove?: (request: WalletRequest) => string | undefined;
  /** Making or repairing: a line with no code, or whose recording stopped working, is done by a model. A run never sets it. */
  byModel?: boolean;
  /** The values this run picked ("287.40"): how a recording names the one row among several that is this run's own. */
  values?: string[];
  /** An action a model found already done is recorded as nothing to do. Not in a cleanup: what it finds depends on where the test stopped. */
  recordNothing?: boolean;
  signal?: AbortSignal;
}

/**
 * How a line went, without the time and the cost: the walker adds those. `repair` is set when a run with no
 * model couldn't go on because the line has no code, or its recording no longer fits the page.
 */
export type Went = Pick<LineResult, "status" | "by"> & Partial<Pick<LineResult, "model" | "note" | "did" | "redone" | "recorded">> & { repair?: boolean };

/**
 * What is recorded for an action a model found already done ("dismiss the notice if there is one"): the
 * line is code from then on, and a run goes past it. A repair asks a model again.
 */
export const NOTHING_TO_DO: BrowserAction = { kind: "wait", until: "idle", note: "Nothing to do: it is already so" };
export const isNothingToDo = (recording: BrowserAction[]): boolean => recording.length === 1 && recording[0]!.kind === "wait" && recording[0]!.note === NOTHING_TO_DO.note;

/** What a run with no model says of a line it has no code for. */
export const NOT_CODE = "This line isn't written as code yet.";
/** How its note begins when the recording of a line stopped working. */
export const NOT_AS_RECORDED = "The page isn't as recorded";

/** Reviews a request before the wallet approves it. A review that can't be made is told, not fatal. */
export async function reviewRequest(run: Running, request: WalletRequest): Promise<void> {
  const { session, env } = run;
  const screenshot = await session.screenshot(`sign-${request.id}`);
  const ui = { buttonLabel: session.lastClickedLabel(), pageUrl: session.page.url(), screenshot };
  const review = await env.reviewer
    .review({ request, chains: env.chains, ui })
    .catch((e) => debug(`signing review failed: ${e instanceof Error ? e.message : e}`));
  if (review) run.reviews.push(review);
}

/** What the wallet was asked to sign or send since this began, or with `latest` since the latest action did. */
export const signRequests = (run: Running, latest = false): WalletRequest[] =>
  run.session.wallet.requests().slice(latest ? (run.actedAt ?? run.since) : run.since).filter((r) => r.kind === "sign");

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
