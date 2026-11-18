/**
 * Running one test, or a suite's setup or reset, in a browser of its own: line by line, then the outcome.
 * A run calls no model. A line that isn't code yet, or whose recording no longer fits the page, stops it
 * as Couldn't verify, and the result says the test can be repaired. Only making and repairing pass
 * `byModel`, and then a model does such a line and what it did comes back as the recording.
 */
import { fillValues, LineResult, outcomeOf, sentence, urlOnApp, type Action, type Check, type SigningReview, type Suite, type SetupStuck, type Test, type TestResult, type WalletRequest } from "@dappdrill/core";
import { settle } from "../agent/tools.js";
import { saveState, type EngineSession } from "../browser/session.js";
import { NO_FUNDS } from "../wallet/errors.js";
import type { Env } from "./env.js";
import { debug, EMPTY_PAGE, landingBotCheck, openSession, plain } from "./session.js";
import { doAction } from "./action.js";
import { checkByCode, readBefore, unreadBefore } from "./code-check.js";
import { checkByModel } from "./llm-check.js";
import { pageText } from "./page.js";
import { NOT_CODE, type Running, type Went } from "./running.js";

export interface RunOptions {
  artifactsDir: string;
  /** Where the setup left the browser: its storage, and the wallet's connection to the site. */
  storageState?: string;
  /** What is known about the app, for whoever does an action. */
  notes?: string[];
  /** Why a wallet request must not be approved, when it mustn't. */
  refuseApprove?: (request: WalletRequest) => string | undefined;
  /**
   * Making or repairing: a line with no code, or whose recording stopped working, is done by a model, and
   * what it did comes back in the line's `recorded`. Missing on every run: no model is called.
   */
  byModel?: boolean;
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
  /** The first line that didn't pass is one a run with no model couldn't do: it has no code, or its recording no longer fits. */
  repairable: boolean;
  video?: string;
}

/** What is gone through line by line: a test, the setup or the reset. */
interface Walkable {
  id: string;
  name: string;
  goal: string;
  startPath: string;
  steps: (Action | Check)[];
  cleanup?: Action[];
  /** The values this run picked, for a test. */
  values?: string[];
}

/** How much of the page's text is kept with a line that didn't pass. */
const PAGE_KEPT = 6_000;
const pageKept = async (session: EngineSession) => (await pageText(session.page).catch(() => "")).slice(0, PAGE_KEPT) || undefined;

const skipped = (line: Action | Check): LineResult => LineResult.parse({ status: "skipped", by: line.by });
const usd = (n: number) => Math.round(n * 10_000) / 10_000;

/** Opens the start page and goes through the lines. `then` runs with the browser still open, when every line passed. */
async function walk(env: Env, what: Walkable, opts: RunOptions, then?: (session: EngineSession) => Promise<void>): Promise<Walked> {
  const session = await openSession(env, opts.artifactsDir, { storageState: opts.storageState });
  const out: Walked = { steps: what.steps.map(skipped), cleanup: [], reviews: [], pageErrors: [], repairable: false };
  try {
    await session.page.goto(urlOnApp(what.startPath, env.target.url), { waitUntil: "domcontentloaded" });
    const block = await landingBotCheck(session);
    if (block) return { ...out, blocked: block.reason };
    const run: Running = {
      env,
      session,
      name: what.name,
      goal: what.goal,
      steps: what.steps,
      since: session.wallet.requests().length,
      acted: Date.now(),
      reviews: out.reviews,
      before: new Map(),
      notes: opts.notes ?? [],
      refuseApprove: opts.refuseApprove,
      byModel: opts.byModel,
      values: what.values,
      recordNothing: true,
      signal: opts.signal,
    };
    await settle(session);
    await readBefore(run);
    const unread = unreadBefore(run);
    if (unread) {
      out.steps[unread.line] = LineResult.parse({
        status: "unsure",
        by: "code",
        note: unread.note,
        page: await pageKept(session),
        screenshot: await session.screenshot(`${what.id}-${unread.line + 1}`),
      });
      opts.onLine?.(unread.line, out.steps[unread.line]!);
      return out;
    }
    /** A check: by its code, and one that has none is answered by a model only while making or repairing. */
    const check = (of: Running, i: number, line: Check): Promise<Went> | Went => {
      if (line.by === "code") return checkByCode(of, line);
      return of.byModel ? checkByModel(of, i) : { status: "unsure", by: "llm", repair: true, note: NOT_CODE };
    };
    /** One line, timed and priced, with a picture of the page after it. `repair` when no model was there to do it. */
    const go = async (of: Running, i: number, shot: string): Promise<{ result: LineResult; repair: boolean }> => {
      if (of.signal?.aborted) throw new Error("stopped");
      session.touch();
      const line = of.steps[i]!;
      const t0 = Date.now();
      if (line.type === "action") {
        of.acted = t0;
        of.actedAt = session.wallet.requests().length;
      }
      const cost0 = env.costUsd();
      const { repair, ...went } = line.type === "action" ? await doAction(of, i) : await check(of, i, line);
      // Kept for whoever has to say why it didn't pass, or to write as code a check a model answered from it.
      const keep = went.status !== "pass" || (line.type === "check" && line.by === "llm");
      const page = keep ? await pageKept(session) : undefined;
      const result = LineResult.parse({ ...went, page, durationMs: Date.now() - t0, costUsd: usd(env.costUsd() - cost0), screenshot: await session.screenshot(shot) });
      return { result, repair: repair === true };
    };
    let stopped = false;
    let threw: unknown;
    try {
      for (const [i, line] of what.steps.entries()) {
        // Once a line hasn't passed nothing more is done; the checks before the next action still say what they find.
        if (stopped && line.type === "action") break;
        const { result, repair } = await go(run, i, `${what.id}-${i + 1}`);
        out.steps[i] = result;
        opts.onLine?.(i, result);
        if (result.status === "pass") continue;
        if (repair && !stopped) out.repairable = true;
        stopped = true;
        // An action we couldn't do leaves nothing for the checks after it to look at: they'd fail on the app for our
        // sake. A line with no code stops the run the same way: what comes after it was written to follow it.
        if (repair || (line.type === "action" && result.status === "unsure")) break;
      }
    } catch (e) {
      threw = e;
    }
    // What the test did stays on the chain and in the account, so it is taken back whenever the test didn't get
    // all the way through: a check that failed, a line that broke, a stop.
    const tidy = stopped || threw !== undefined;
    if (tidy && what.cleanup?.length) {
      const tidying: Running = { ...run, goal: "Take back what the test left behind before it stopped.", steps: what.cleanup, recordNothing: false, signal: undefined };
      try {
        for (const i of what.cleanup.keys()) {
          out.cleanup.push((await go(tidying, i, `${what.id}-cleanup-${i + 1}`)).result);
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
  const walked = await walk(env, { ...test, values: Object.values(values) }, opts);
  const decided = decide(test, walked);
  return {
    testId: test.id,
    ...decided,
    steps: walked.steps,
    values,
    cleanup: walked.cleanup,
    reset: [],
    // A check that failed is a failure, whatever came after it.
    repairable: walked.repairable && decided.outcome === "unverified",
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

/** What the setup is for, where a test has its goal. */
export const SETUP_GOAL = "Start every test as a user who is already in.";

/**
 * Does the setup, or the reset (`as` says which, for its lines' pictures and whoever does them), and saves
 * where it left the browser. `storageState` is set when every line was done. When a run with no model stopped
 * on a line a repair would do, `stuck.fix` is "repair".
 */
export async function runSetup(
  env: Env,
  setup: NonNullable<Suite["setup"]>,
  opts: RunOptions & { saveTo: string; as?: { id: string; name: string; goal: string } },
): Promise<{ steps: LineResult[]; storageState?: string; why?: string; stuck?: SetupStuck }> {
  const what: Walkable = { ...(opts.as ?? { id: "setup", name: "Setup", goal: SETUP_GOAL }), ...setup };
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
  const stuck: SetupStuck = {
    line: at + 1,
    sentence: setup.steps[at]!.do,
    reason: note || "It didn't work.",
    fix: note?.includes(NO_FUNDS) ? "funds" : walked.repairable ? "repair" : undefined,
  };
  return { steps: walked.steps, why: `At the step “${setup.steps[at]!.do}”: ${note || "didn't work"}`, stuck };
}
