/**
 * Running a suite: the setup once, then each test in a browser of its own, on chain state put
 * back after every test. A failure is run once more before it counts, and a run that broke on
 * our side is tried once more quietly before the test is called Couldn't verify.
 */
import path from "node:path";
import { chainName, copyBehindLine, type DrillEventSink, type DrillTarget, type LineResult, type SetupStuck, type Suite, type SuiteResult, type Test, type TestResult, type WalletRequest } from "@dappdrill/core";
import { openEnv, withoutFallback, type Env } from "./env.js";
import { pin, spoiledBy } from "./pin.js";
import { debug, plain } from "./session.js";
import { runSetup, runTest, type RunOptions } from "./test.js";

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
  /** A line of the setup (`testId` undefined) or of a test finished. */
  onLine?: (testId: string | undefined, index: number, result: LineResult) => void;
  /** A test's result. A stopped run throws, so these are all there is of the tests that finished. */
  onTest?: (result: TestResult) => void;
}

/** An app made ready for its tests: the chains up and the setup done. */
export interface OpenSuite {
  env: Env;
  /** The setup's lines, when the suite has one. */
  setup?: LineResult[];
  /** Why the setup didn't finish. Nothing can be run then. */
  stuck?: string;
  /** The same, in parts: the line it stopped at and what went wrong there. */
  stuckAt?: SetupStuck;
  /** What every run starts from: where the setup left the browser, and what is known about the app. */
  opts: RunOptions;
  /** One run of a test, with forks put back afterwards to how they were. */
  run(test: Test, onLine?: RunOptions["onLine"]): Promise<TestResult>;
  close(): Promise<void>;
}

export interface OpenSuiteOptions {
  /** Why a request may not be approved, asked for the setup's lines too, so it is handed the env rather than waiting for the open suite. */
  refuseApprove?: (request: WalletRequest, env: Env) => string | undefined;
  onLine?: RunOptions["onLine"];
}

export async function openSuite(input: RunSuiteInput, sink: DrillEventSink = () => {}, more: OpenSuiteOptions = {}): Promise<OpenSuite> {
  const { suite, artifactsDir, signal } = input;
  const env = await openEnv(input.target, sink, { headless: input.headless, signal });
  // The suite's own rule comes before whatever the caller allows.
  const refused = () => "Refused: nothing may be approved in the wallet for this app. Reject it and carry on without it.";
  const asked = more.refuseApprove && ((request: WalletRequest) => more.refuseApprove!(request, env));
  const opts: RunOptions = { artifactsDir, signal, notes: suite.notes.map((n) => n.text), refuseApprove: suite.signing === "allowed" ? asked : refused };
  const open: OpenSuite = { env, opts, run: (test, onLine) => onFreshState(env, test, { ...opts, onLine }), close: () => env.close() };
  if (!suite.setup) return open;
  try {
    const done = await runSetup(env, suite.setup, { ...opts, refuseApprove: suite.signing === "refused" ? refused : asked, saveTo: path.join(artifactsDir, "setup-state.json"), onLine: more.onLine });
    open.setup = done.steps;
    opts.storageState = done.storageState;
    if (!done.storageState) {
      open.stuck = `The setup didn't finish. ${done.why}`;
      open.stuckAt = done.stuck;
    }
    return open;
  } catch (e) {
    await env.close();
    // Nothing is returned to count what the setup spent, so it goes on the sink.
    await Promise.resolve(sink({ type: "cost", usd: env.costUsd() })).catch(() => {});
    throw e;
  }
}

export async function runSuite(input: RunSuiteInput, sink: DrillEventSink = () => {}, progress: SuiteProgress = {}): Promise<SuiteResult> {
  const t0 = Date.now();
  const open = await openSuite(input, sink, { onLine: (i, r) => progress.onLine?.(undefined, i, r) });
  const { env, setup } = open;
  const behind = () => env.chains.configs().filter((c) => c.relays).map((c) => c.id);
  const behindBefore = behind();
  try {
    const tests: TestResult[] = [];
    for (const test of input.suite.tests) {
      if (open.stuck) {
        tests.push(notRun(test, open.stuck));
        continue;
      }
      const run = () => {
        // Stopped: no test starts, and no failed one runs again. What finished went to onTest already.
        input.signal?.throwIfAborted();
        progress.onStart?.(test.id);
        return open.run(test, (i, r) => progress.onLine?.(test.id, i, r));
      };
      let result = await run();
      if (result.outcome === "failed") {
        const again = await run();
        const reason = again.outcome === "passed" ? "Failed the first time and passed when run again." : again.reason;
        result = { ...again, reason, rerun: true, firstReason: result.reason, durationMs: result.durationMs + again.durationMs, costUsd: result.costUsd + again.costUsd };
      }
      // A failure on a copy the real chain has left behind says nothing about the app.
      if (result.outcome === "failed") {
        await env.chains.lookForRelays?.();
        const fell = behind().filter((id) => !behindBefore.includes(id));
        if (fell.length) result = { ...result, outcome: "unverified", reason: `${copyBehindLine(fell.map(chainName))}${result.reason ? ` It stopped with: ${result.reason}` : ""}` };
      }
      tests.push(result);
      progress.onTest?.(result);
    }
    // A chain the app's server used for the wallet has moved on from its copy: whoever keeps the chains is told.
    await env.chains.lookForRelays?.();
    await env.sink({ type: "chains", chains: withoutFallback(env.chains.configs()) });
    return { setup, tests, durationMs: Date.now() - t0, costUsd: env.costUsd() };
  } finally {
    await open.close();
  }
}

/** A test with no lines to show: it never began, or broke on our side. */
const notRun = (test: Test, reason: string, durationMs = 0): TestResult => ({ testId: test.id, outcome: "unverified", reason, steps: [], values: {}, cleanup: [], signingReviews: [], rerun: false, durationMs, costUsd: 0 });

/** What breaks on our side gets one more try. */
async function onFreshState(env: Env, test: Test, opts: RunOptions, retry = true): Promise<TestResult> {
  const t0 = Date.now();
  // A test on a fork still holding an earlier run's state could only fail for our sake.
  const spoiled = spoiledBy(env);
  if (spoiled) return notRun(test, `It broke on our side: ${spoiled}`);
  let revert: (() => Promise<void>) | undefined;
  let result: TestResult | undefined;
  try {
    revert = await pin(env);
    result = await runTest(env, test, opts);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    debug(`${test.name} broke on our side: ${plain(e)}`);
    if (!retry) result = notRun(test, `It broke on our side: ${plain(e)}`, Date.now() - t0);
  } finally {
    // When this fails, this test's result still stands (it began on a clean fork); the ones after it are refused above.
    await revert?.();
  }
  return result ?? onFreshState(env, test, opts, false);
}
