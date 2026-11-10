/**
 * Deterministic replay of a saved script inside a session. No model calls.
 * Edge cases plug in through `hooks` to change how wallet requests are
 * answered or to act between steps (switch account, reload, …).
 */
import { applyParams, describeStep, newId, paramValues, type ReplayScript, type SigningReview, type Step, type StepResult, type WalletRequest, urlOnApp } from "@dappdrill/core";
import type { Inbox, Llm, SigningReviewer } from "../types.js";
import type { EngineSession } from "../browser/session.js";
import type { PendingSignRequest } from "../wallet/controller.js";
import { fillField } from "./fill.js";
import { describeLocator, resolveLocator } from "./locators.js";
import { checkExpectation, decodeBuiltin, describeAsked } from "./expectation.js";
import { waitQuiet } from "./quiet.js";

/** How long to look for an optional step's element before deciding it didn't show. */
const OPTIONAL_TIMEOUT_MS = 4_000;
/** How long a busy button ("Placing…") gets to finish after a click, before the next step. */
const QUIET_MS = 15_000;
/** A fork reads state upstream the first time, so a dApp's data can take half a minute to show. */
export const STEP_TIMEOUT_MS = 45_000;

export interface StepContext {
  script: ReplayScript;
  index: number;
  step: Step;
  session: EngineSession;
  params: Record<string, string>;
  /** 0-based index among the script's wallet steps. */
  signIndex: number;
}

export interface ReplayHooks {
  /** Runs before a step. "skip" marks it skipped; "stop" ends the replay after it. */
  beforeStep?(ctx: StepContext): Promise<void | "skip" | "stop">;
  /** Decides how to answer a signing request. "default" follows the step's `respond`. */
  respond?(ctx: StepContext & { pending: PendingSignRequest }): Promise<"approve" | "reject" | "default">;
  /** Runs after a step; "stop" ends the replay here. */
  afterStep?(ctx: StepContext, result: StepResult): Promise<void | "stop">;
}

export interface ReplayScriptOptions {
  params?: Record<string, string>;
  reviewer?: SigningReviewer;
  /** Lets the reviewer compare vague button labels with the request. Scans only: CI replays stay model-free. */
  reviewLlm?: Llm;
  baselines?: Record<string, SigningReview>;
  inbox?: Inbox;
  /** Per-step timeout for finding elements and waiting (default 45s). */
  stepTimeoutMs?: number;
  /** How long a `wallet` step waits for the dApp to ask (default 30s). */
  signTimeoutMs?: number;
  hooks?: ReplayHooks;
  /** Continue on the page the session is on instead of opening the script's start URL. */
  here?: boolean;
  runId?: string;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export interface WalletStepInfo {
  stepIndex: number;
  request: WalletRequest;
  pending: PendingSignRequest;
  /** What the wallet was asked for, in plain words. */
  asked: string;
  response: "approve" | "reject";
  /** Error returned by the chain when approving (e.g. insufficient funds). */
  approveError?: string;
  /** Another signing request arrived from the same click. */
  doubleSubmission?: WalletRequest;
  /** The request didn't match the step's WalletExpectation. */
  expectationProblems: string[];
  expectationWarnings: string[];
}

export interface ReplayScriptResult {
  steps: StepResult[];
  signingReviews: SigningReview[];
  walletRequests: WalletRequest[];
  walletSteps: WalletStepInfo[];
  /** True when every non-optional step passed and nothing stopped the replay early. */
  completed: boolean;
  /** First hard failure, plainly. */
  error?: string;
  /** Replay was ended by a hook (e.g. after a rejection), not by a failure. */
  stoppedByHook: boolean;
}

export async function replayScript(session: EngineSession, script: ReplayScript, opts: ReplayScriptOptions = {}): Promise<ReplayScriptResult> {
  // {{account}} is whichever test account this replay runs with; head and tail make up its short form.
  const account = session.wallet.address();
  const params = { account, "account-head": account.slice(0, 6), "account-tail": account.slice(-4), ...paramValues(script, opts.params) };
  const stepTimeout = opts.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  const signTimeout = opts.signTimeoutMs ?? 30_000;
  const log = opts.log ?? (() => {});
  const runId = opts.runId ?? newId("rpl");
  const startedAt = Date.now();

  const result: ReplayScriptResult = { steps: [], signingReviews: [], walletRequests: [], walletSteps: [], completed: false, stoppedByHook: false };
  let signIndex = 0;
  let stopped = false;
  // An optional one-time prompt (terms, cookie banner) that didn't show also asks for nothing.
  let triggerSkipped = false;

  // A saved script starts at its startUrl even when the first step isn't an explicit goto.
  if (!opts.here && script.steps[0]?.kind !== "goto") {
    try {
      await gotoUrl(session, script.startUrl, params, stepTimeout);
    } catch (e) {
      result.error = `Could not open ${script.startUrl}: ${e instanceof Error ? e.message : e}`;
      result.walletRequests = session.wallet.requests();
      return result;
    }
  }

  for (let index = 0; index < script.steps.length && !stopped; index++) {
    const step = script.steps[index]!;
    const ctx: StepContext = { script, index, step, session, params, signIndex };
    const t0 = Date.now();
    if (opts.signal?.aborted) {
      result.error = "cancelled";
      break;
    }

    const before = await opts.hooks?.beforeStep?.(ctx);
    if (before === "skip") {
      result.steps.push({ index, status: "skipped", durationMs: 0 });
      if (step.kind === "wallet") signIndex++;
      continue;
    }
    if (before === "stop") stopped = true;
    if (step.kind === "wallet" && triggerSkipped) {
      result.steps.push({ index, status: "skipped", durationMs: 0, error: "the optional step that asks for it didn't show" });
      log(`step ${index} skipped: its optional trigger didn't show`);
      signIndex++;
      continue;
    }

    session.touch();
    log(`step ${index}: ${describeStep(step)}`);
    let stepResult: StepResult;
    try {
      const walletRequestId = await runStep(ctx, { stepTimeout: step.optional ? OPTIONAL_TIMEOUT_MS : stepTimeout, signTimeout, opts, result, runId, startedAt });
      stepResult = { index, status: "pass", durationMs: Date.now() - t0, walletRequestId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const screenshot = await session.screenshot(`${runId}-step${index}-fail`);
      stepResult = { index, status: step.optional ? "skipped" : "fail", durationMs: Date.now() - t0, error: message, screenshot };
      log(`step ${index} ${step.optional ? "skipped (optional)" : "failed"}: ${message}`);
    }
    if (step.kind === "wallet") signIndex++;
    else triggerSkipped = stepResult.status === "skipped";
    result.steps.push(stepResult);

    const after = await opts.hooks?.afterStep?.(ctx, stepResult);
    if (after === "stop") {
      stopped = true;
      result.stoppedByHook = true;
    }
    if (stepResult.status === "fail") {
      result.error ??= `Step ${index + 1} (${describeStep(step)}): ${stepResult.error}`;
      break;
    }
  }

  result.walletRequests = session.wallet.requests();
  result.completed = !result.error && result.steps.every((s) => s.status !== "fail") && !stopped;
  return result;
}

async function gotoUrl(session: EngineSession, url: string, params: Record<string, string>, timeout: number): Promise<void> {
  const abs = urlOnApp(applyParams(url, params), session.target.url);
  await session.page.goto(abs, { waitUntil: "domcontentloaded", timeout: Math.max(timeout, 30_000) });
  await session.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
}

interface RunEnv {
  stepTimeout: number;
  signTimeout: number;
  opts: ReplayScriptOptions;
  result: ReplayScriptResult;
  runId: string;
  startedAt: number;
}

/** Returns the wallet request id for wallet steps. Throws on failure. */
async function runStep(ctx: StepContext, env: RunEnv): Promise<string | undefined> {
  const { step, session, params } = ctx;
  const { page } = session;
  const timeout = env.stepTimeout;

  switch (step.kind) {
    case "goto":
      // Leaving while the app is still placing or sending throws that work away.
      await waitQuiet(page, QUIET_MS, () => session.wallet.peekSigns().length > 0);
      await gotoUrl(session, step.url, params, timeout);
      return;
    case "click": {
      const el = await resolveLocator(page, step.target, timeout);
      await el.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
      await el.click({ timeout });
      await page.waitForTimeout(300);
      const busy = await waitQuiet(page, QUIET_MS, () => session.wallet.peekSigns().length > 0);
      if (busy) (env.opts.log ?? (() => {}))(`waited for “${busy}” to finish`);
      return;
    }
    case "fill": {
      const el = await resolveLocator(page, step.target, timeout);
      const value = applyParams(step.value, params);
      const filled = await fillField(page, el, value, timeout);
      if (!filled.took) throw new Error(`Typed "${value}" into ${describeLocator(step.target)}, but the field shows "${filled.shows}"`);
      return;
    }
    case "select": {
      const el = await resolveLocator(page, step.target, timeout);
      const value = applyParams(step.value, params);
      await el.selectOption({ label: value }, { timeout }).catch(() => el.selectOption(value, { timeout }));
      return;
    }
    case "press": {
      if (step.target) await (await resolveLocator(page, step.target, timeout)).press(step.key, { timeout });
      else await page.keyboard.press(step.key);
      return;
    }
    case "wait": {
      if (step.until === "ms") await page.waitForTimeout(step.ms ?? 1000);
      else if (step.until === "idle") await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
      else await page.getByText(applyParams(step.text ?? "", params)).first().waitFor({ state: "visible", timeout });
      return;
    }
    case "expect": {
      const a = step.assert;
      if (a.type === "visible") {
        const text = applyParams(a.text, params);
        await page.getByText(text).first().waitFor({ state: "visible", timeout }).catch(() => {
          throw new Error(`Expected to see "${text}" but it never appeared`);
        });
      } else if (a.type === "not-visible") {
        const text = applyParams(a.text, params);
        await page.getByText(text).first().waitFor({ state: "hidden", timeout }).catch(() => {
          throw new Error(`Expected "${text}" to disappear but it is still visible`);
        });
      } else {
        const want = applyParams(a.contains, params);
        const deadline = Date.now() + timeout;
        while (!page.url().includes(want)) {
          if (Date.now() > deadline) throw new Error(`Expected the URL to contain "${want}", it is ${page.url()}`);
          await page.waitForTimeout(200);
        }
      }
      return;
    }
    case "email-code": {
      if (!env.opts.inbox) throw new Error("This test reads a login code from the test inbox, but no inbox is configured");
      const code = await env.opts.inbox.latestCode({ sinceMs: env.startedAt, timeoutMs: Math.max(timeout, 60_000) });
      const el = await resolveLocator(page, step.target, timeout);
      await el.fill(code, { timeout });
      return;
    }
    case "wallet":
      return walletStep(ctx, env);
  }
}

async function walletStep(ctx: StepContext, env: RunEnv): Promise<string> {
  const { step, session, script, index, params } = ctx;
  if (step.kind !== "wallet") throw new Error("not a wallet step");
  const { wallet, chains } = session;
  const log = env.opts.log ?? (() => {});

  const pending = await wallet.nextSign(env.signTimeout);
  const req = pending.request;
  const buttonLabel = pending.buttonLabel ?? session.lastClickedLabel();
  const screenshot = await session.screenshot(`${env.runId}-step${index}-wallet`);
  log(`wallet asked: ${req.method} (button "${buttonLabel ?? "?"}")`);

  let review: SigningReview | undefined;
  if (env.opts.reviewer) {
    try {
      review = await env.opts.reviewer.review({
        request: req,
        chains,
        ui: { buttonLabel, pageUrl: pending.pageUrl, screenshot },
        script: { id: script.id, name: script.name, stepIndex: index, expectation: step.expect, params },
        baselines: env.opts.baselines ?? {},
        artifactsDir: session.artifactsDir,
        llm: env.opts.reviewLlm,
      });
      review.runId = env.runId;
      env.result.signingReviews.push(review);
      await session.emit({ type: "signing-review", review });
    } catch (e) {
      log(`signing review failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const decoded = review?.decoded ?? decodeBuiltin(req);
  const check = await checkExpectation(step.expect, req, decoded, chains, params);
  const info: WalletStepInfo = {
    stepIndex: index,
    request: req,
    pending,
    asked: describeAsked(decoded, req),
    response: step.respond,
    expectationProblems: check.problems,
    expectationWarnings: check.warnings,
  };
  env.result.walletSteps.push(info);
  for (const w of check.warnings) log(`expectation note: ${w}`);

  if (!check.ok) {
    await wallet.reject(req.id);
    throw new Error(`The wallet request doesn't match the test: ${check.problems.join("; ")}`);
  }

  const decision = (await env.opts.hooks?.respond?.({ ...ctx, pending })) ?? "default";
  info.response = decision === "default" ? step.respond : decision;

  if (info.response === "reject") {
    await wallet.reject(req.id);
  } else {
    try {
      await wallet.approve(req.id);
    } catch (e) {
      info.approveError = e instanceof Error ? e.message : String(e);
      const data = (e as { data?: { message?: string } }).data?.message;
      throw new Error(`The wallet could not send the transaction: ${data ?? info.approveError}`);
    }
  }

  // Double submission: the same signing request again from the same click (an approve
  // followed by the deposit it unlocks is one click too, but a different request).
  await session.page.waitForTimeout(1_200);
  const extra = wallet.peekSigns().find((p) => p.clickSeq === pending.clickSeq && sameRequest(p.request, req));
  if (extra) info.doubleSubmission = extra.request;
  return req.id;
}

/** Same method and payload (for transactions: to, data, value). */
export function sameRequest(a: WalletRequest, b: WalletRequest): boolean {
  if (a.method !== b.method) return false;
  const strip = (r: WalletRequest) => {
    const p = Array.isArray(r.params) ? r.params : [];
    if (r.method === "eth_sendTransaction" || r.method === "eth_signTransaction") {
      const tx = (p[0] ?? {}) as Record<string, unknown>;
      return JSON.stringify({ to: tx.to, data: tx.data ?? tx.input, value: tx.value });
    }
    return JSON.stringify(p);
  };
  return strip(a) === strip(b);
}
