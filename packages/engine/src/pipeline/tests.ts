/**
 * Running tests. A happy path goes step by step: cached actions first, the
 * fast model when they break, then a check of the expected result. An unhappy
 * path replays its base test's cached actions under a wallet or network
 * condition through the edge-case matrix, with no model except the judge.
 */
import {
  conditionInfo,
  describeStep,
  TestRunResult,
  type AppMap,
  type AppSetup,
  type FlowRun,
  type SigningReview,
  type Step,
  type TestRunStatus,
  type TestSpec,
  type TestStep, urlOnApp } from "@dappdrill/core";
import { createRecoveryJudge } from "../agent/index.js";
import { judgeExpected } from "../agent/tester.js";
import { runEdgeCases } from "../runtime.js";
import type { Env } from "./env.js";
import { pin } from "./flows.js";
import { setupRunner, type Prepared, type SetupRunner } from "./setup.js";
import { BlockedError, debug, flowOf, landingBotCheck, openSession, plain, walkSteps } from "./steps.js";

export { landingBotCheck };

export interface TestItem {
  spec: TestSpec;
  /** For an unhappy path: the test it runs under its condition. */
  base?: TestSpec;
  /** Stops just this test. */
  signal?: AbortSignal;
}

export interface TestOutcome {
  testId: string;
  status: TestRunStatus;
  result: TestRunResult;
  /** The test's steps with the actions that worked this time, to save. */
  steps?: TestStep[];
  /** An unhappy path whose base had no cached actions ran the base first: its refreshed steps. */
  baseSteps?: TestStep[];
}

export interface TestHooks {
  onStart?(testId: string): Promise<void>;
  /** The result so far, after each step. */
  onProgress?(testId: string, result: TestRunResult): Promise<void>;
  /** A live frame, relative to artifactsDir. */
  onFrame?(testId: string, path: string): Promise<void>;
  onDone?(outcome: TestOutcome): Promise<void>;
  /** The app's setup steps with the actions that worked, to save. */
  onSetupSteps?(steps: TestStep[]): Promise<void>;
}

export interface RunTestsOptions {
  artifactsDir: string;
  map?: AppMap;
  baselines?: Record<string, SigningReview>;
  signal?: AbortSignal;
  /** Steps every test needs first; see pipeline/setup.ts for when they run. */
  setup?: AppSetup;
}

export async function runTestItems(env: Env, items: TestItem[], opts: RunTestsOptions, hooks: TestHooks): Promise<TestOutcome[]> {
  const outcomes: TestOutcome[] = [];
  // Steps learned earlier in this batch, so an unhappy path uses its base's fresh actions.
  const fresh = new Map<string, TestStep[]>();
  const setup = opts.setup?.steps.length ? setupRunner(env, opts.setup, opts, hooks) : undefined;
  try {
    for (const item of items) {
      const signal = item.signal && opts.signal ? AbortSignal.any([item.signal, opts.signal]) : (item.signal ?? opts.signal);
      if (opts.signal?.aborted) break;
      await hooks.onStart?.(item.spec.id);
      const spent = env.costUsd();
      const base = item.base && fresh.has(item.base.id) ? { ...item.base, steps: fresh.get(item.base.id)! } : item.base;
      const outcome: TestOutcome = signal?.aborted
        ? { testId: item.spec.id, status: "stopped", result: TestRunResult.parse({}) }
        : await runItem(env, item.spec, base, opts, hooks, setup, signal);
      outcome.result.costUsd = Math.round((env.costUsd() - spent) * 1000) / 1000;
      if (outcome.steps) fresh.set(item.spec.id, outcome.steps);
      if (outcome.baseSteps && base) fresh.set(base.id, outcome.baseSteps);
      outcomes.push(outcome);
      await hooks.onDone?.(outcome);
    }
  } finally {
    await setup?.close();
  }
  return outcomes;
}

/** One test, after the app's setup when it has one. */
async function runItem(env: Env, spec: TestSpec, base: TestSpec | undefined, opts: RunTestsOptions, hooks: TestHooks, setup: SetupRunner | undefined, signal?: AbortSignal): Promise<TestOutcome> {
  const run = (pre: Prepared) => (spec.condition && base ? runCondition(env, spec, base, opts, hooks, pre, signal) : runHappy(env, spec, opts, hooks, pre, signal));
  if (!setup) return run({});
  // Before each test: the pin also takes back what the setup did on forks.
  const restore = setup.when() === "each" ? await pin(env) : undefined;
  try {
    const p = await setup.prepare(spec, signal);
    return "outcome" in p ? p.outcome : await run(p.pre);
  } finally {
    await restore?.();
  }
}

async function runHappy(env: Env, spec: TestSpec, opts: RunTestsOptions, hooks: TestHooks, pre: Prepared, signal?: AbortSignal): Promise<TestOutcome> {
  const result = TestRunResult.parse({ setup: pre.setup, steps: spec.steps.map(() => ({ status: "pending" })) });
  const steps = spec.steps.map((s) => ({ ...s }));
  const progress = () => hooks.onProgress?.(spec.id, result);
  let status: TestRunStatus = "pass";

  const restore = await pin(env);
  const session = await openSession(env, opts.artifactsDir, (p) => hooks.onFrame?.(spec.id, p) ?? Promise.resolve(), { storageState: pre.storageState });
  const reviews: SigningReview[] = [...(pre.reviews ?? [])];

  try {
    await session.page.goto(urlOnApp(spec.startPath, env.target.url), { waitUntil: "domcontentloaded", timeout: 45_000 });
    const blocked = await landingBotCheck(session);
    if (blocked) throw new BlockedError(blocked);

    const walk = await walkSteps(env, session, spec, steps, result.steps, reviews, { ...opts, signal, progress });
    if (walk.failure) {
      status = walk.stuck ? "error" : "fail";
      result.failure = walk.failure;
    }

    if (status === "pass") {
      const v = await judgeExpected(session, env.fastLlm(), spec);
      result.verdict = { ok: v.ok, reason: v.reason };
      if (!v.ok) {
        status = "fail";
        result.failure = `The expected result didn't show: ${v.reason}`;
      }
    }
  } catch (e) {
    status = signal?.aborted ? "stopped" : "error";
    result.failure = e instanceof BlockedError ? `Blocked: ${e.blocked.reason}` : signal?.aborted ? undefined : plain(e);
    for (const s of result.steps) if (s.status === "pending" || s.status === "running") s.status = "skipped";
  } finally {
    result.finalScreenshot = await session.screenshot("final").catch(() => undefined);
    result.walletRequests = [...(pre.walletRequests ?? []), ...session.wallet.requests()];
    result.console = session.console.filter((c) => c.level === "error" || c.level === "pageerror").slice(-50);
    result.signingReviews = reviews;
    result.video = (await session.close().catch(() => ({}) as { video?: string })).video;
    await restore();
  }
  return { testId: spec.id, status, result, steps: status === "stopped" ? undefined : steps };
}

async function runCondition(env: Env, spec: TestSpec, base: TestSpec, opts: RunTestsOptions, hooks: TestHooks, pre: Prepared, signal?: AbortSignal): Promise<TestOutcome> {
  const condition = spec.condition!;
  let source = base;
  let baseSteps: TestStep[] | undefined;
  if (base.steps.some((s) => !s.actions)) {
    // The base never passed in full: run it to learn its actions.
    const b = await runHappy(env, base, opts, { onFrame: (_id, p) => hooks.onFrame?.(spec.id, p) ?? Promise.resolve() }, pre, signal);
    baseSteps = b.steps;
    if (b.status !== "pass" || !b.steps) {
      const status = b.status === "stopped" ? "stopped" : "error";
      return { testId: spec.id, status, baseSteps, result: TestRunResult.parse({ setup: pre.setup, failure: `“${base.name}” has to pass first. ${b.result.failure ?? ""}`.trim() }) };
    }
    source = { ...base, steps: b.steps };
  }

  // Each action remembers which step it belongs to, so results map back onto the steps.
  const actions: Step[] = [];
  const owner: number[] = [];
  source.steps.forEach((s, i) => s.actions?.forEach((a) => (actions.push(a), owner.push(i))));

  const restore = await pin(env);
  let run: FlowRun | undefined;
  let issues: TestRunResult["issues"] = [];
  let reviews: SigningReview[] = [];
  try {
    const r = await runEdgeCases({
      target: env.target,
      chains: env.chains,
      flow: flowOf(source, actions),
      edgeCases: [condition],
      reviewer: env.reviewer,
      judge: createRecoveryJudge(env.fastLlm()),
      inbox: env.inbox,
      sink: async (e) => {
        if (e.type === "frame") await hooks.onFrame?.(spec.id, e.path);
      },
      artifactsDir: opts.artifactsDir,
      baselines: opts.baselines,
      headless: env.headless,
      storageState: pre.storageState,
      signal,
      log: debug,
    });
    run = r.runs[0];
    issues = r.issues;
    reviews = r.signingReviews;
  } catch (e) {
    return { testId: spec.id, status: "error", baseSteps, result: TestRunResult.parse({ setup: pre.setup, failure: plain(e) }) };
  } finally {
    await restore();
  }
  if (!run) return { testId: spec.id, status: "stopped", baseSteps, result: TestRunResult.parse({ setup: pre.setup }) };

  const ran = run.steps;
  const steps = source.steps.map((_, i) => {
    const mine = ran.filter((r) => owner[r.index] === i);
    const failed = mine.find((r) => r.status === "fail");
    // A step with no actions passed when the replay got past it.
    const passed = mine.some((r) => r.status === "pass") || (mine.length === 0 && ran.some((r) => owner[r.index]! > i));
    return {
      status: failed ? ("fail" as const) : passed ? ("pass" as const) : ("skipped" as const),
      via: "cache" as const,
      did: mine.filter((r) => r.status === "pass").map((r) => describeStep(actions[r.index]!)),
      note: failed?.error,
      screenshot: failed?.screenshot,
      durationMs: mine.reduce((sum, r) => sum + r.durationMs, 0),
    };
  });
  const status: TestRunStatus = run.status === "pass" ? "pass" : run.status === "issue" || run.status === "fail" ? "fail" : run.status;
  const found = issues.map((i) => i.title).join("; ");
  const result = TestRunResult.parse({
    setup: pre.setup,
    steps,
    verdict: status === "pass" || status === "fail" ? { ok: status === "pass", reason: found || run.reason || conditionInfo(condition)?.expected || "" } : undefined,
    failure: status === "pass" ? undefined : found || run.reason,
    walletRequests: [...(pre.walletRequests ?? []), ...run.walletRequests],
    signingReviews: [...(pre.reviews ?? []), ...reviews],
    issues,
    console: run.console.filter((c) => c.level === "error" || c.level === "pageerror").slice(-50),
    video: run.video,
    finalScreenshot: run.finalScreenshot,
  });
  return { testId: spec.id, status, result, baseSteps };
}
