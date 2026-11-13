/** Running one test, or a suite's setup, in a browser of its own: line by line, then the outcome. */
import { fillValues, LineResult, outcomeOf, sentence, urlOnApp, type Action, type Check, type SigningReview, type Suite, type SetupStuck, type Test, type TestResult, type WalletRequest } from "@dappdrill/core";
import { settle } from "../agent/tools.js";
import { saveState, type EngineSession } from "../browser/session.js";
import { NO_LIVE_KEY } from "../wallet/errors.js";
import type { Env } from "./env.js";
import { debug, EMPTY_PAGE, landingBotCheck, openSession, plain } from "./session.js";
import { doAction } from "./action.js";
import { checkByCode, readBefore } from "./code-check.js";
import { checkByModel } from "./llm-check.js";
import { pageText } from "./page.js";
import type { Running } from "./running.js";

export interface RunOptions {
  artifactsDir: string;
  /** Where the setup left the browser: its storage, and the wallet's connection to the site. */
  storageState?: string;
  /** What is known about the app, for whoever does an action. */
  notes?: string[];
  /** Why a wallet request must not be approved by a model, when it mustn't. */
  refuseApprove?: (request: WalletRequest) => string | undefined;
  signal?: AbortSignal;
  /** As each line finishes. */
  onLine?: (index: number, result: LineResult) => void;
}

interface Walked {
  steps: LineResult[];
  cleanup: LineResult[];
  reviews: SigningReview[];
  /** A bot check or a refusal on the first page, before any line. */
  blocked?: string;
  /** Errors the page threw and nothing caught. */
  pageErrors: string[];
  video?: string;
}

type Walkable = { id: string; name: string; goal: string; startPath: string; steps: (Action | Check)[]; cleanup?: Action[] };

/** How much of the page's text is kept with a line that didn't pass. */
const PAGE_KEPT = 6_000;

const skipped = (line: Action | Check): LineResult => LineResult.parse({ status: "skipped", by: line.by });
const usd = (n: number) => Math.round(n * 10_000) / 10_000;

/** Opens the start page and goes through the lines. `then` runs with the browser still open, when every line passed. */
async function walk(env: Env, what: Walkable, opts: RunOptions, then?: (session: EngineSession) => Promise<void>): Promise<Walked> {
  const session = await openSession(env, opts.artifactsDir, { storageState: opts.storageState });
  const out: Walked = { steps: what.steps.map(skipped), cleanup: [], reviews: [], pageErrors: [] };
  try {
    await session.page.goto(urlOnApp(what.startPath, env.target.url), { waitUntil: "domcontentloaded" });
    const block = await landingBotCheck(session);
    if (block) return { ...out, blocked: block.reason };
    const run: Running = { env, session, name: what.name, goal: what.goal, steps: what.steps, since: session.wallet.requests().length, acted: Date.now(), reviews: out.reviews, before: new Map(), notes: opts.notes ?? [], refuseApprove: opts.refuseApprove, signal: opts.signal };
    await settle(session);
    await readBefore(run);
    /** One line, timed and priced, with a picture of the page after it. */
    const go = async (of: Running, i: number, shot: string): Promise<LineResult> => {
      if (of.signal?.aborted) throw new Error("stopped");
      session.touch();
      const line = of.steps[i]!;
      const t0 = Date.now();
      if (line.type === "action") of.acted = t0;
      const cost0 = env.costUsd();
      const went = line.type === "action" ? await doAction(of, i) : line.by === "code" ? await checkByCode(of, line) : await checkByModel(of, i);
      const page = went.status === "pass" ? undefined : (await pageText(session.page).catch(() => "")).slice(0, PAGE_KEPT) || undefined;
      return LineResult.parse({ ...went, page, durationMs: Date.now() - t0, costUsd: usd(env.costUsd() - cost0), screenshot: await session.screenshot(shot) });
    };
    let stopped = false;
    let threw: unknown;
    try {
      for (const [i, line] of what.steps.entries()) {
        // Once a line hasn't passed nothing more is done; the checks before the next action still say what they find.
        if (stopped && line.type === "action") break;
        out.steps[i] = await go(run, i, `${what.id}-${i + 1}`);
        opts.onLine?.(i, out.steps[i]!);
        if (out.steps[i]!.status === "pass") continue;
        stopped = true;
        // An action we couldn't do leaves nothing for the checks after it to look at: they'd fail on the app for our sake.
        if (line.type === "action" && out.steps[i]!.status === "unsure") break;
      }
    } catch (e) {
      threw = e;
    }
    // On a live chain what the test did stays, so it is taken back whenever the test didn't get all the way
    // through: a check that failed, a line that broke, a stop. On a fork the chain is put back anyway, and
    // the cleanup only runs when an action was left undone.
    const live = env.chains.configs().some((c) => c.mode === "live");
    const actionUndone = what.steps.some((s, i) => s.type === "action" && out.steps[i]!.status !== "pass");
    const tidy = live ? stopped || threw !== undefined : actionUndone && threw === undefined && !opts.signal?.aborted;
    if (tidy && what.cleanup?.length) {
      const tidying: Running = { ...run, goal: "Take back what the test left behind before it stopped.", steps: what.cleanup, signal: undefined };
      try {
        for (const i of what.cleanup.keys()) {
          out.cleanup.push(await go(tidying, i, `${what.id}-cleanup-${i + 1}`));
          if (out.cleanup[i]!.status !== "pass") break;
        }
      } catch (e) {
        debug(`${what.name}: the cleanup broke: ${plain(e)}`);
      }
    }
    if (threw !== undefined) throw threw;
    if (!stopped) await then?.(session);
  } finally {
    out.pageErrors = session.console.filter((c) => c.level === "pageerror").map((c) => c.text.split("\n")[0]!);
    out.video = (await session.close()).video;
  }
  return out;
}

export async function runTest(env: Env, written: Test, opts: RunOptions): Promise<TestResult> {
  const { test, values } = fillValues(written);
  const t0 = Date.now();
  const cost0 = env.costUsd();
  const walked = await walk(env, test, opts);
  return {
    testId: test.id,
    ...decide(test, walked),
    steps: walked.steps,
    values,
    cleanup: walked.cleanup,
    signingReviews: walked.reviews,
    rerun: false,
    video: walked.video,
    durationMs: Date.now() - t0,
    costUsd: usd(env.costUsd() - cost0),
  };
}

/**
 * Failed: a line failed, the wallet was asked for something dangerous, or the page threw an error.
 * Couldn't verify: nothing failed, but a line wasn't settled or wasn't reached.
 */
function decide(test: Test, walked: Walked): Pick<TestResult, "outcome" | "reason"> {
  if (walked.blocked) return { outcome: "unverified", reason: walked.blocked === EMPTY_PAGE ? EMPTY_PAGE : `Blocked: ${walked.blocked}` };
  const line = (i: number) => {
    return `“${sentence(test.steps[i]!)}”: ${walked.steps[i]!.note || (walked.steps[i]!.status === "skipped" ? "not reached" : "didn't work")}`;
  };
  const failed = walked.steps.findIndex((s) => s.status === "fail");
  if (failed >= 0) return { outcome: "failed", reason: line(failed) };
  const dangerous = walked.reviews.find((r) => r.verdict === "dangerous");
  if (dangerous) return { outcome: "failed", reason: `The wallet was asked for something dangerous: ${dangerous.title}. ${dangerous.explanation}` };
  if (walked.pageErrors.length) return { outcome: "failed", reason: `The page threw an error: ${walked.pageErrors[0]}` };
  const outcome = outcomeOf(walked.steps);
  return outcome === "passed" ? { outcome } : { outcome, reason: line(walked.steps.findIndex((s) => s.status !== "pass")) };
}

/** Does the setup once and saves where it left the browser. `storageState` is set when every line was done. */
export async function runSetup(env: Env, setup: NonNullable<Suite["setup"]>, opts: RunOptions & { saveTo: string }): Promise<{ steps: LineResult[]; storageState?: string; why?: string; stuck?: SetupStuck }> {
  const what: Walkable = { id: "setup", name: "Setup", goal: "Start every test as a user who is already in.", ...setup };
  let saved = false;
  const walked = await walk(env, what, opts, async (session) => {
    await saveState(session, opts.saveTo);
    saved = true;
  });
  if (saved) return { steps: walked.steps, storageState: opts.saveTo };
  const at = walked.steps.findIndex((s) => s.status !== "pass");
  if (walked.blocked === EMPTY_PAGE) return { steps: walked.steps, why: EMPTY_PAGE, stuck: { reason: EMPTY_PAGE } };
  if (walked.blocked) return { steps: walked.steps, why: `Blocked: ${walked.blocked}`, stuck: { reason: `The app shut us out: ${walked.blocked}` } };
  const note = walked.steps[at]!.note;
  const stuck: SetupStuck = { line: at + 1, sentence: setup.steps[at]!.do, reason: note || "It didn't work.", fix: note?.includes(NO_LIVE_KEY) ? "funds" : undefined };
  return { steps: walked.steps, why: `At the step “${setup.steps[at]!.do}”: ${note || "didn't work"}`, stuck };
}
