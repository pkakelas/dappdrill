/**
 * Running tests. A happy path goes step by step: cached actions first, the
 * fast model when they break, then a check of the expected result. An unhappy
 * path replays its base test's cached actions under a wallet or network
 * condition through the edge-case matrix, with no model except the judge.
 */
import {
  conditionInfo,
  describeStep,
  newId,
  TestRunResult,
  type AppMap,
  type Blocked,
  type DrillEvent,
  type Flow,
  type FlowRun,
  type SigningReview,
  type Step,
  type TestRunStatus,
  type TestSpec,
  type TestStep,
  type WalletRequest,
} from "@dappdrill/core";
import { createRecoveryJudge } from "../agent/index.js";
import { judgeExpected, runStep } from "../agent/tester.js";
import { detectBotCheck } from "../browser/access.js";
import { createSession, replayFlow, runEdgeCases, type EngineSession } from "../runtime.js";
import type { Env } from "./env.js";
import { pin } from "./flows.js";

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
  proof?: string;
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
}

export interface RunTestsOptions {
  artifactsDir: string;
  map?: AppMap;
  baselines?: Record<string, SigningReview>;
  signal?: AbortSignal;
}

const debug = (m: string) => {
  if (process.env.DAPPDRILL_DEBUG) console.error(`[engine] ${m}`);
};

export async function runTestItems(env: Env, items: TestItem[], opts: RunTestsOptions, hooks: TestHooks): Promise<TestOutcome[]> {
  const outcomes: TestOutcome[] = [];
  // Steps learned earlier in this batch, so an unhappy path uses its base's fresh actions.
  const fresh = new Map<string, TestStep[]>();
  for (const item of items) {
    const signal = item.signal && opts.signal ? AbortSignal.any([item.signal, opts.signal]) : (item.signal ?? opts.signal);
    if (opts.signal?.aborted) break;
    await hooks.onStart?.(item.spec.id);
    const spent = env.costUsd();
    const base = item.base && fresh.has(item.base.id) ? { ...item.base, steps: fresh.get(item.base.id)! } : item.base;
    const outcome = signal?.aborted
      ? { testId: item.spec.id, status: "stopped" as const, result: TestRunResult.parse({}) }
      : item.spec.condition && base
        ? await runCondition(env, item.spec, base, opts, hooks, signal)
        : await runHappy(env, item.spec, opts, hooks, signal);
    outcome.result.costUsd = Math.round((env.costUsd() - spent) * 1000) / 1000;
    if (outcome.steps) fresh.set(item.spec.id, outcome.steps);
    if (outcome.baseSteps && base) fresh.set(base.id, outcome.baseSteps);
    outcomes.push(outcome);
    await hooks.onDone?.(outcome);
  }
  return outcomes;
}

/** A session whose live frames go to the given test. */
function testSession(env: Env, testId: string, artifactsDir: string, hooks: TestHooks): Promise<EngineSession> {
  return createSession(env.target, env.chains, {
    artifactsDir,
    headless: env.headless,
    runId: newId("run"),
    log: debug,
    sink: async (e: DrillEvent) => {
      if (e.type === "frame") await hooks.onFrame?.(testId, e.path);
      else if (e.type === "log" && e.level !== "info") await env.sink(e);
    },
  });
}

async function runHappy(env: Env, spec: TestSpec, opts: RunTestsOptions, hooks: TestHooks, signal?: AbortSignal): Promise<TestOutcome> {
  const result = TestRunResult.parse({ steps: spec.steps.map(() => ({ status: "pending" })) });
  const steps = spec.steps.map((s) => ({ ...s }));
  const progress = () => hooks.onProgress?.(spec.id, result);
  let status: TestRunStatus = "pass";
  let proof: string | undefined;

  const restore = await pin(env);
  const session = await testSession(env, spec.id, opts.artifactsDir, hooks);
  const reviews: SigningReview[] = [];
  const beforeApprove = async (request: WalletRequest) => {
    const screenshot = await session.screenshot(`sign-${request.id}`);
    const review = await env.reviewer
      .review({ request, chains: env.chains, ui: { buttonLabel: session.lastClickedLabel(), pageUrl: session.page.url(), screenshot }, baselines: opts.baselines ?? {}, artifactsDir: opts.artifactsDir })
      .catch((e) => debug(`signing review failed: ${e instanceof Error ? e.message : e}`));
    if (review) reviews.push(review);
  };
  const replay = async (actions: Step[]) => {
    const r = await replayFlow(session, flowOf(spec, actions), { here: true, reviewer: env.reviewer, baselines: opts.baselines, inbox: env.inbox, signal, log: debug });
    reviews.push(...r.signingReviews);
    return { ok: r.completed, error: r.error };
  };

  try {
    await session.page.goto(new URL(spec.startPath, env.target.url).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const blocked = await landingBotCheck(session);
    if (blocked) throw new BlockedError(blocked);

    for (const [i, step] of spec.steps.entries()) {
      if (signal?.aborted) throw new Error("stopped");
      result.steps[i]!.status = "running";
      await progress();
      session.touch();
      const t0 = Date.now();
      const out = await runStep(
        { session, fast: env.fastLlm(), strong: env.actLlm(), map: opts.map, inbox: env.inbox, replay, beforeApprove, signal },
        { ...spec, steps },
        i,
      );
      if (out.blocked) throw new BlockedError(out.blocked);
      if (out.actions) steps[i] = { text: step.text, actions: out.actions };
      result.steps[i] = {
        status: out.ok ? "pass" : "fail",
        via: out.via,
        did: out.did,
        note: out.note,
        screenshot: await session.screenshot(`step${i + 1}`),
        durationMs: Date.now() - t0,
      };
      if (!out.ok) {
        status = "fail";
        result.failure = `Step ${i + 1}, “${step.text}”: ${out.note ?? "didn't work"}`;
        for (const later of result.steps.slice(i + 1)) later.status = "skipped";
        break;
      }
      await progress();
    }

    if (status === "pass") {
      const v = await judgeExpected(session, env.fastLlm(), spec);
      result.verdict = { ok: v.ok, reason: v.reason };
      proof = v.proof;
      if (!v.ok) {
        status = "fail";
        result.failure = `The expected result didn't show: ${v.reason}`;
      }
    }
  } catch (e) {
    status = signal?.aborted ? "stopped" : "error";
    result.failure = e instanceof BlockedError ? `A bot check blocked the test: ${e.blocked.reason}` : signal?.aborted ? undefined : plain(e);
    for (const s of result.steps) if (s.status === "pending" || s.status === "running") s.status = "skipped";
  } finally {
    result.finalScreenshot = await session.screenshot("final").catch(() => undefined);
    result.walletRequests = session.wallet.requests();
    result.console = session.console.filter((c) => c.level === "error" || c.level === "pageerror").slice(-50);
    result.signingReviews = reviews;
    result.video = (await session.close().catch(() => ({}) as { video?: string })).video;
    await restore();
  }
  return { testId: spec.id, status, result, steps: status === "stopped" ? undefined : steps, proof };
}

async function runCondition(env: Env, spec: TestSpec, base: TestSpec, opts: RunTestsOptions, hooks: TestHooks, signal?: AbortSignal): Promise<TestOutcome> {
  const condition = spec.condition!;
  let source = base;
  let baseSteps: TestStep[] | undefined;
  if (base.steps.some((s) => !s.actions)) {
    // The base never passed in full: run it to learn its actions.
    const b = await runHappy(env, base, opts, { onFrame: (_id, p) => hooks.onFrame?.(spec.id, p) ?? Promise.resolve() }, signal);
    baseSteps = b.steps;
    if (b.status !== "pass" || !b.steps) {
      const status = b.status === "stopped" ? "stopped" : "error";
      return { testId: spec.id, status, baseSteps, result: TestRunResult.parse({ failure: `“${base.name}” has to pass first. ${b.result.failure ?? ""}`.trim() }) };
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
      signal,
      log: debug,
    });
    run = r.runs[0];
    issues = r.issues;
    reviews = r.signingReviews;
  } catch (e) {
    return { testId: spec.id, status: "error", baseSteps, result: TestRunResult.parse({ failure: plain(e) }) };
  } finally {
    await restore();
  }
  if (!run) return { testId: spec.id, status: "stopped", baseSteps, result: TestRunResult.parse({}) };

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
    steps,
    verdict: status === "pass" || status === "fail" ? { ok: status === "pass", reason: found || run.reason || conditionInfo(condition)?.expected || "" } : undefined,
    failure: status === "pass" ? undefined : found || run.reason,
    walletRequests: run.walletRequests,
    signingReviews: reviews,
    issues,
    console: run.console.filter((c) => c.level === "error" || c.level === "pageerror").slice(-50),
    video: run.video,
    finalScreenshot: run.finalScreenshot,
  });
  return { testId: spec.id, status, result, baseSteps };
}

function flowOf(spec: Pick<TestSpec, "id" | "name" | "startPath">, steps: Step[]): Flow {
  return { id: spec.id, name: spec.name, origin: "described", startUrl: spec.startPath, params: [], steps };
}

class BlockedError extends Error {
  constructor(readonly blocked: Blocked) {
    super(blocked.reason);
  }
}

function plain(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
}

/** Challenges often load a moment after the page; look twice before calling the page clean. */
export async function landingBotCheck(session: EngineSession): Promise<Blocked | undefined> {
  const first = await detectBotCheck(session.page);
  if (first) return first;
  await session.page.waitForTimeout(2_500);
  return detectBotCheck(session.page);
}
