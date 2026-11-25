/**
 * Running a suite: each test in a browser of its own, on a clean start. With new accounts that is a
 * wallet nobody has seen, paid from the owner's key what the test starts with and taken through the
 * setup; what the test leaves on it is sent back to that key. On a kept account the setup is done once
 * and the suite's reset lines put the account back before each test. A failure is run once more before
 * it counts, and a run that broke on our side is tried once more quietly before the test is called
 * Couldn't verify.
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { noteText, nowIso, type DrillEventSink, type DrillTarget, type Fund, type LineResult, type SetupStuck, type Suite, type SuiteResult, type Test, type TestResult, type WalletRequest } from "@dappdrill/core";
import type { Hex } from "../types.js";
import { fundAccount, newAccounts, openEnv, withAccounts, withoutFallback, type Accounts, type AccountSeed, type Env } from "./env.js";
import { debug, plain } from "./session.js";
import { sendBack } from "./sweep.js";
import { runSetup, runTest, SETUP_GOAL, type RunOptions } from "./test.js";

export interface RunSuiteInput {
  target: DrillTarget;
  suite: Suite;
  artifactsDir: string;
  headless?: boolean;
  signal?: AbortSignal;
}

export interface SuiteProgress {
  /** A test is about to run. A test that failed starts a second time. */
  onStart?: (testId: string) => void;
  /** A line of the setup done when the suite opens (`testId` undefined) or of a test finished. */
  onLine?: (testId: string | undefined, index: number, result: LineResult) => void;
  /** A test's result. A stopped run throws, so these are all there is of the tests that finished. */
  onTest?: (result: TestResult) => void;
}

/** What one test starts from. */
export interface Fresh {
  /** The env to run on: on new accounts, a child of the suite's env with accounts of its own. */
  env: Env;
  /** What a run starts from: `storageState` is where the setup (and the reset) left the browser. */
  opts: RunOptions;
  setup?: LineResult[];
  reset?: LineResult[];
  /** Why there is no clean start. Nothing can be run on it then. */
  why?: string;
  stuck?: SetupStuck;
}

/** An app made ready for its tests: the chains known and the first start made. */
export interface OpenSuite {
  /** The chains, models and cost, shared by every start. */
  env: Env;
  /** The setup's lines from the first start, when the suite has one. */
  setup?: LineResult[];
  /** Why the first start couldn't be made: the new account wasn't paid, or the setup didn't finish. Nothing can be run then. */
  stuck?: string;
  /** The same, in parts: the line it stopped at and what went wrong there. */
  stuckAt?: SetupStuck;
  /** What is known about the app and what may be approved. On a kept account also where the setup left the browser. */
  opts: RunOptions;
  /**
   * A clean start. New accounts: a wallet of its own, paid `fund` (the app's own list when left out) and
   * set up; the one made when the suite opened goes to the first caller that asks for what it was paid.
   * Kept account: the same env, after the suite's reset lines when it has them.
   */
  fresh(onLine?: RunOptions["onLine"], fund?: Fund[]): Promise<Fresh>;
  /** fresh() with what the test starts with, then runTest. `more` is laid over the start's opts: a prove run passes `{ byModel: false }`. */
  run(test: Test, more?: Partial<Pick<RunOptions, "onLine" | "byModel">>): Promise<TestResult>;
  /** A start taken with fresh() is done with: what its new account holds goes back to the key while the next one starts. run() does this itself. */
  finished(start: Fresh): void;
  /** Sends back what the new accounts still hold, then closes the chains. */
  close(): Promise<void>;
}

export interface OpenSuiteOptions {
  /** Why a request may not be approved, asked for the setup's lines too, so it is handed the env rather than waiting for the open suite. */
  refuseApprove?: (request: WalletRequest, env: Env) => string | undefined;
  /** As each line of the first start's setup finishes. */
  onLine?: RunOptions["onLine"];
  /** A model does what has no code yet. Only while making or repairing: a run never sets it. */
  byModel?: boolean;
  /** What the first start's new account is paid, when the first test to run says what it starts with. */
  fund?: Fund[];
}

export async function openSuite(input: RunSuiteInput, sink: DrillEventSink = () => {}, more: OpenSuiteOptions = {}): Promise<OpenSuite> {
  const { suite, artifactsDir, signal } = input;
  const env = await openEnv(input.target, sink, { headless: input.headless, signal, fundChains: [...(more.fund ?? []), ...suite.tests.flatMap((t) => t.fund ?? [])].map((f) => f.chainId) });
  const kept = env.target.account === "kept";
  const { fundedKey } = env.target;
  const say = (message: string, level: "info" | "warn" = "info") => env.sink({ type: "log", level, message, at: nowIso() });

  // New accounts paid by a key are made from it and an id of this run's own, so they can be emptied again.
  const seed: AccountSeed | undefined = !kept && fundedKey ? { fundedKey, runId: randomBytes(6).toString("hex") } : undefined;
  if (seed) {
    await say(`This run's test accounts are made from the funding key under the id ${seed.runId}. What a test leaves on one is sent back to that key.`);
    // Kept with the run, for collecting what a run that was cut short left behind (dev/collect.ts).
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(path.join(artifactsDir, "test-accounts.json"), `${JSON.stringify({ runId: seed.runId, fundedBy: privateKeyToAccount(seed.fundedKey as Hex).address })}\n`);
  }
  /** Every new account made here, and the ERC-20s any of them was paid. */
  const made: Accounts[] = [];
  const paid: Fund[] = [...env.target.fund, ...suite.tests.flatMap((t) => t.fund ?? [])];
  const another = (): Env => {
    const accounts = newAccounts(seed, made.length + 1);
    made.push(accounts);
    return withAccounts(env, accounts);
  };
  /** Transfers back still on their way. The next account is paid once they have landed, so the key holds what it held. */
  const returning = new Set<Promise<void>>();
  const giveBack = (accounts: Accounts): void => {
    if (!seed) return;
    const going = sendBack(env.chains, seed.fundedKey, accounts, paid, say).finally(() => returning.delete(going));
    returning.add(going);
  };
  const close = async () => {
    try {
      await Promise.all(returning);
      // Once more over every account: a transfer that arrived after its test ended, a start nobody took.
      if (seed) for (const accounts of made) await sendBack(env.chains, seed.fundedKey, accounts, paid, say);
    } finally {
      await env.close();
    }
  };
  // The suite's own rule comes before whatever the caller allows.
  const refused = () => "Refused: nothing may be approved in the wallet for this app. Reject it and carry on without it.";
  const asked = (on: Env) => more.refuseApprove && ((request: WalletRequest) => more.refuseApprove!(request, on));
  const optsOn = (on: Env): RunOptions => ({
    artifactsDir,
    signal,
    notes: suite.notes.map(noteText),
    refuseApprove: suite.signing === "allowed" ? asked(on) : refused,
    byModel: more.byModel,
  });

  let starts = 0;
  /** A start from nothing on `on`: a new account is paid first, then the setup is done in a browser of its own. */
  const begin = async (on: Env, fund: Fund[], onLine?: RunOptions["onLine"]): Promise<Fresh> => {
    const n = ++starts;
    const opts = optsOn(on);
    if (!kept) {
      if (fund.some((f) => !paid.includes(f))) paid.push(...fund);
      try {
        await Promise.all(returning);
        await fundAccount(env.chains, { fundedKey, fund }, privateKeyToAccount(on.target.accounts!.A as Hex).address);
      } catch (e) {
        if (signal?.aborted) throw e;
        const reason = e instanceof Error ? e.message : String(e);
        return { env: on, opts, why: reason, stuck: { reason, fix: "funds" } };
      }
    }
    if (!suite.setup) return { env: on, opts };
    const done = await runSetup(on, suite.setup, {
      ...opts,
      refuseApprove: suite.signing === "refused" ? refused : asked(on),
      saveTo: path.join(artifactsDir, n === 1 ? "setup-state.json" : `setup-state-${n}.json`),
      onLine,
      as: n === 1 ? undefined : { id: `setup-${n}`, name: "Setup", goal: SETUP_GOAL },
    });
    if (done.storageState) return { env: on, opts: { ...opts, storageState: done.storageState }, setup: done.steps };
    return { env: on, opts, setup: done.steps, why: `The setup didn't finish. ${done.why}`, stuck: done.stuck };
  };

  const firstFund = more.fund ?? env.target.fund;
  let first: Fresh;
  try {
    first = await begin(kept ? env : another(), firstFund, more.onLine);
  } catch (e) {
    await close();
    // Nothing is returned to count what the setup spent, so it goes on the sink.
    await Promise.resolve(sink({ type: "cost", usd: env.costUsd() })).catch(() => {});
    throw e;
  }
  /** With new accounts: the first start, until a caller that wants what it was paid has taken it. */
  let waiting: Fresh | undefined = first;
  let resets = 0;

  const fresh: OpenSuite["fresh"] = async (onLine, fund = env.target.fund) => {
    if (!kept) {
      if (!waiting || !sameFund(fund, firstFund)) return begin(another(), fund, onLine);
      const taken = waiting;
      waiting = undefined;
      return taken;
    }
    if (first.why || !suite.reset) return first;
    const done = await runSetup(env, suite.reset, {
      ...first.opts,
      saveTo: path.join(artifactsDir, "reset-state.json"),
      onLine,
      as: { id: `reset-${++resets}`, name: "Reset", goal: "Put the account back to where a test expects it, whatever earlier tests left on it." },
    });
    if (done.storageState) return { ...first, opts: { ...first.opts, storageState: done.storageState }, reset: done.steps };
    return { ...first, reset: done.steps, why: `The reset didn't finish. ${done.why}`, stuck: done.stuck };
  };

  /** What breaks on our side gets one more try, on another clean start. */
  const run = async (test: Test, over: Parameters<OpenSuite["run"]>[1] = {}, retry = true): Promise<TestResult> => {
    const t0 = Date.now();
    let start: Fresh | undefined;
    try {
      start = await fresh(undefined, test.fund);
      if (start.why) return unstarted(test, start, Date.now() - t0);
      const result = await runTest(start.env, test, { ...start.opts, onLine: over.onLine, byModel: over.byModel ?? start.opts.byModel });
      return { ...result, reset: start.reset ?? [] };
    } catch (e) {
      if (signal?.aborted) throw e;
      debug(`${test.name} broke on our side: ${plain(e)}`);
      if (!retry) return notRun(test, `It broke on our side: ${plain(e)}`, Date.now() - t0);
    } finally {
      // The test is over, however it went: what its account holds goes back while the next one starts.
      if (start && !kept) giveBack(start.env.target.accounts!);
    }
    return run(test, over, false);
  };

  return {
    env,
    // With new accounts the browser state belongs to one start, so the suite's own opts have none.
    opts: kept ? first.opts : optsOn(env),
    setup: first.setup,
    stuck: first.why,
    stuckAt: first.stuck,
    fresh,
    run: (test, over) => run(test, over),
    finished: (start) => {
      if (!kept) giveBack(start.env.target.accounts!);
    },
    close,
  };
}

/** Two lists that pay an account the same. */
const sameFund = (a: Fund[], b: Fund[]) => JSON.stringify(a) === JSON.stringify(b);

export async function runSuite(input: RunSuiteInput, sink: DrillEventSink = () => {}, progress: SuiteProgress = {}): Promise<SuiteResult> {
  const t0 = Date.now();
  const open = await openSuite(input, sink, { onLine: (i, r) => progress.onLine?.(undefined, i, r), fund: input.suite.tests[0]?.fund });
  const { env, setup } = open;
  try {
    const tests: TestResult[] = [];
    for (const test of input.suite.tests) {
      // The next start would stop where the first did, unless that was for funds this test doesn't ask for.
      const ownFunds = input.target.account === "new" && open.stuckAt?.fix === "funds" && !sameFund(test.fund ?? input.target.fund, input.suite.tests[0]?.fund ?? input.target.fund);
      if (open.stuck && !ownFunds) {
        tests.push(unstarted(test, { why: open.stuck, stuck: open.stuckAt }));
        continue;
      }
      const run = () => {
        // Stopped: no test starts, and no failed one runs again. What finished went to onTest already.
        input.signal?.throwIfAborted();
        progress.onStart?.(test.id);
        return open.run(test, { onLine: (i, r) => progress.onLine?.(test.id, i, r) });
      };
      let result = await run();
      if (result.outcome === "failed") {
        const again = await run();
        const reason = again.outcome === "passed" ? "Failed the first time and passed when run again." : again.reason;
        result = {
          ...again,
          reason,
          rerun: true,
          firstReason: result.reason,
          durationMs: result.durationMs + again.durationMs,
          costUsd: result.costUsd + again.costUsd,
        };
      }
      tests.push(result);
      progress.onTest?.(result);
    }
    // The app may have asked the wallet for a chain nobody knew of: whoever keeps the chains is told.
    await env.sink({ type: "chains", chains: withoutFallback(env.chains.configs()) });
    return { setup, tests, durationMs: Date.now() - t0, costUsd: env.costUsd() };
  } finally {
    await open.close();
  }
}

/** A test with no lines to show: it never began, or broke on our side. */
const notRun = (test: Test, reason: string, durationMs = 0): TestResult => ({
  testId: test.id,
  outcome: "unverified",
  reason,
  steps: [],
  values: {},
  cleanup: [],
  reset: [],
  repairable: false,
  signingReviews: [],
  rerun: false,
  durationMs,
  costUsd: 0,
});

/**
 * A test whose start couldn't be made: Couldn't verify, with why. When no model was there and the setup
 * or the reset stopped on a line it couldn't do, repairing may put it right.
 */
function unstarted(test: Test, start: Pick<Fresh, "why" | "stuck" | "reset">, durationMs = 0): TestResult {
  return { ...notRun(test, start.why!, durationMs), reset: start.reset ?? [], repairable: start.stuck?.fix === "repair" };
}
