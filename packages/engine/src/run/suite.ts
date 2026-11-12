/**
 * Running a suite: the setup once, then each test in a browser of its own, on chain state put
 * back after every test. A failure is run once more before it counts, and a run that broke on
 * our side is tried once more quietly before the test is called Couldn't verify.
 */
import path from "node:path";
import type { DrillEventSink, DrillTarget, LineResult, Suite, SuiteResult, Test, TestResult } from "@dappdrill/core";
import { openEnv, type Env } from "../pipeline/env.js";
import { pin } from "../pipeline/pin.js";
import { debug, plain } from "../pipeline/session.js";
import { runSetup, runTest, type RunOptions } from "./test.js";

export interface RunSuiteInput {
  target: DrillTarget;
  suite: Suite;
  artifactsDir: string;
  headless?: boolean;
  signal?: AbortSignal;
}

export interface SuiteProgress {
  /** A line of the setup (`testId` undefined) or of a test finished. */
  onLine?: (testId: string | undefined, index: number, result: LineResult) => void;
  onTest?: (result: TestResult) => void;
}

/** An app made ready for its tests: the chains up and the setup done. */
export interface OpenSuite {
  env: Env;
  /** The setup's lines, when the suite has one. */
  setup?: LineResult[];
  /** Why the setup didn't finish. Nothing can be run then. */
  stuck?: string;
  /** What every run starts from: where the setup left the browser, and what is known about the app. */
  opts: RunOptions;
  /** One run of a test, with forks put back afterwards to how they were. */
  run(test: Test, onLine?: RunOptions["onLine"]): Promise<TestResult>;
  close(): Promise<void>;
}

export async function openSuite(input: RunSuiteInput, sink: DrillEventSink = () => {}, more: Pick<RunOptions, "refuseApprove" | "onLine"> = {}): Promise<OpenSuite> {
  const { suite, artifactsDir, signal } = input;
  const env = await openEnv(input.target, sink, { headless: input.headless });
  const opts: RunOptions = { artifactsDir, signal, notes: suite.notes.map((n) => n.text), refuseApprove: more.refuseApprove };
  const open: OpenSuite = { env, opts, run: (test, onLine) => onFreshState(env, test, { ...opts, onLine }), close: () => env.close() };
  if (!suite.setup) return open;
  try {
    const done = await runSetup(env, suite.setup, { ...opts, saveTo: path.join(artifactsDir, "setup-state.json"), onLine: more.onLine });
    open.setup = done.steps;
    opts.storageState = done.storageState;
    if (!done.storageState) open.stuck = `The setup didn't finish. ${done.why}`;
    return open;
  } catch (e) {
    await env.close();
    throw e;
  }
}

export async function runSuite(input: RunSuiteInput, sink: DrillEventSink = () => {}, progress: SuiteProgress = {}): Promise<SuiteResult> {
  const t0 = Date.now();
  const open = await openSuite(input, sink, { onLine: (i, r) => progress.onLine?.(undefined, i, r) });
  const { env, setup } = open;
  try {
    const tests: TestResult[] = [];
    for (const test of input.suite.tests) {
      if (open.stuck) {
        tests.push(notRun(test, open.stuck));
        continue;
      }
      const run = () => open.run(test, (i, r) => progress.onLine?.(test.id, i, r));
      let result = await run();
      if (result.outcome === "failed") {
        const again = await run();
        const reason = again.outcome === "passed" ? "Failed the first time and passed when run again." : again.reason;
        result = { ...again, reason, rerun: true, firstReason: result.reason, durationMs: result.durationMs + again.durationMs, costUsd: result.costUsd + again.costUsd };
      }
      tests.push(result);
      progress.onTest?.(result);
    }
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
  const revert = await pin(env);
  try {
    return await runTest(env, test, opts);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    debug(`${test.name} broke on our side: ${plain(e)}`);
    if (!retry) return notRun(test, `It broke on our side: ${plain(e)}`, Date.now() - t0);
  } finally {
    await revert();
  }
  return onFreshState(env, test, opts, false);
}
