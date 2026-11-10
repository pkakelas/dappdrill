/**
 * Running tests. A happy path goes step by step: cached actions first, the
 * fast model when they break, then a check of the expected result. An unhappy
 * path replays its base test's cached actions under a wallet or network
 * condition through the edge-case matrix, with no model except the judge.
 */
import {
  conditionInfo,
  describeStep,
  failedAt,
  forkUnseenLine,
  TestRunResult,
  urlOnApp,
  type AppMap,
  type AppSetup,
  type Blame,
  type ConditionRun,
  type SecondLook,
  type SigningReview,
  type Step,
  type TestRunStatus,
  type TestSpec,
  type TestStep,
  type WalletRequest,
  walletUse,
} from "@dappdrill/core";
import { createRecoveryJudge } from "../agent/index.js";
import { judgeExpected, readBaseline } from "../agent/tester.js";
import { runEdgeCases } from "../runtime.js";
import type { Env } from "./env.js";
import { liveShortfall, shortfallLine } from "./funds.js";
import { pin } from "./pin.js";
import { secondLook } from "./second-look.js";
import { setupRunner, type Prepared, type SetupRunner, type SetupTestOutcome } from "./setup.js";
import { BlockedError, debug, scriptOf, landingBotCheck, openSession, plain, walkSteps } from "./steps.js";

export { landingBotCheck };

export interface TestItem {
  spec: TestSpec;
  /** For an unhappy path: the test it runs under its condition. */
  base?: TestSpec;
  /** Stops just this test. */
  signal?: AbortSignal;
  /** The second look at this test's last failure. A failure at the same place keeps it instead of checking again. */
  known?: { at: number; look: SecondLook };
}

export interface TestOutcome {
  testId: string;
  status: TestRunStatus;
  result: TestRunResult;
  /** The test's steps with the actions that worked this time, to save. */
  steps?: TestStep[];
  /** An unhappy path whose base had no cached actions ran the base first: its refreshed steps. */
  baseSteps?: TestStep[];
  /** The cleanup steps with the actions that worked, when they ran. */
  after?: TestStep[];
}

export interface TestHooks {
  onStart?(testId: string): Promise<void>;
  /** The result so far, after each step. */
  onProgress?(testId: string, result: TestRunResult): Promise<void>;
  /** A live frame, relative to artifactsDir. */
  onFrame?(testId: string, path: string): Promise<void>;
  onDone?(outcome: TestOutcome): Promise<void>;
  /** The result again, once a failure has been checked a second time. */
  onSecondLook?(testId: string, result: TestRunResult): Promise<void>;
  /** The app's setup steps, and its reset steps when it has them, with the actions that worked, to save. */
  onSetupSteps?(steps: TestStep[], reset?: TestStep[]): Promise<void>;
}

export interface RunTestsOptions {
  artifactsDir: string;
  map?: AppMap;
  baselines?: Record<string, SigningReview>;
  signal?: AbortSignal;
  /** Steps every test needs first; see pipeline/setup.ts for when they run. */
  setup?: AppSetup;
  /** Check each failed test again by hand before calling it the app's fault. */
  secondLook?: boolean;
  /** The setup's result from another fork of the same block, used instead of running it again (see SetupRunner.portable). */
  ready?: Prepared;
}

export async function runTestItems(env: Env, items: TestItem[], opts: RunTestsOptions, hooks: TestHooks): Promise<TestOutcome[]> {
  const outcomes: TestOutcome[] = [];
  // Steps learned earlier in this batch, so an unhappy path uses its base's fresh actions.
  const fresh = new Map<string, TestStep[]>();
  const looks: { item: TestItem; outcome: TestOutcome; signal?: AbortSignal }[] = [];
  const setup = opts.setup?.steps.length ? setupRunner(env, opts.setup, opts, hooks, opts.ready) : undefined;
  // A live chain spends the funded wallet's coin; a run it can't pay for is the owner's to fix, not the app's.
  // One whose recorded steps never ask our wallet to sign is paid by the app's own signer (an embedded wallet), so our balance says nothing about it.
  const asksWallet = (steps: TestStep[]) => walletUse(steps) !== "none";
  const mayPay = (opts.setup ? asksWallet(opts.setup.steps) : false) || items.some((i) => asksWallet(i.spec.steps));
  const short = mayPay ? await liveShortfall(env.chains, env.target.liveKey) : undefined;
  if (short) {
    for (const item of items) {
      await hooks.onStart?.(item.spec.id);
      const steps = item.spec.steps.map(() => ({ status: "skipped" as const }));
      const outcome: TestOutcome = { testId: item.spec.id, status: "error", result: TestRunResult.parse({ steps, failure: shortfallLine(short), blame: "input" }) };
      outcomes.push(outcome);
      await hooks.onDone?.(outcome);
    }
    await setup?.close();
    return outcomes;
  }
  try {
    for (const item of items) {
      const signal = item.signal && opts.signal ? AbortSignal.any([item.signal, opts.signal]) : (item.signal ?? opts.signal);
      if (opts.signal?.aborted) break;
      await hooks.onStart?.(item.spec.id);
      const spent = env.costUsd();
      const base = item.base && fresh.has(item.base.id) ? { ...item.base, steps: fresh.get(item.base.id)! } : item.base;
      // Anything thrown on the way (a fork that won't snapshot, a browser that won't open) is ours too.
      const attempt = () =>
        runItem(env, item.spec, base, opts, hooks, setup, signal).catch((e): TestOutcome => {
          const steps = item.spec.steps.map(() => ({ status: "skipped" as const }));
          return signal?.aborted ? { testId: item.spec.id, status: "stopped", result: TestRunResult.parse({ steps }) } : { testId: item.spec.id, status: "error", result: TestRunResult.parse({ steps, ...broke(e) }) };
        });
      let outcome: TestOutcome = signal?.aborted ? { testId: item.spec.id, status: "stopped", result: TestRunResult.parse({}) } : await attempt();
      // Something of ours broke: once more, quietly, before anyone hears of it.
      if (outcome.status === "error" && outcome.result.blame === "ours" && !signal?.aborted) outcome = await attempt();
      if (opts.secondLook && outcome.status === "fail" && !item.spec.condition) {
        const known = item.known?.at === failedAt(outcome.result) ? item.known.look : undefined;
        outcome.result.secondLook = known ?? { verdict: "checking" };
        if (!known) looks.push({ item, outcome, signal });
      }
      outcome.result.costUsd = cost(env.costUsd() - spent);
      if (outcome.steps) fresh.set(item.spec.id, outcome.steps);
      if (outcome.baseSteps && base) fresh.set(base.id, outcome.baseSteps);
      outcomes.push(outcome);
      await hooks.onDone?.(outcome);
    }
    // Second looks go last, so no result waits behind one.
    for (const { item, outcome, signal } of looks) {
      const spent = env.costUsd();
      outcome.result.secondLook = await lookAgain(env, item.spec, outcome.result.failure ?? "It didn't pass.", opts, hooks, setup, signal);
      outcome.result.costUsd = cost(outcome.result.costUsd + env.costUsd() - spent);
      await hooks.onSecondLook?.(outcome.testId, outcome.result);
    }
  } finally {
    await setup?.close();
  }
  return outcomes;
}

const cost = (usd: number) => Math.round(usd * 1000) / 1000;

/** One test, after the app's setup when it has one. */
function runItem(env: Env, spec: TestSpec, base: TestSpec | undefined, opts: RunTestsOptions, hooks: TestHooks, setup: SetupRunner | undefined, signal?: AbortSignal): Promise<TestOutcome> {
  const run = (pre: Prepared) => (spec.condition && base ? runCondition(env, spec, base, opts, hooks, pre, signal) : runHappy(env, spec, opts, hooks, pre, signal));
  return afterSetup<TestOutcome>(env, spec, setup, signal, false, run, (outcome) => outcome);
}

/** A failed test once more, by hand, from the same start. It never throws: a look that breaks is unsure. */
async function lookAgain(env: Env, spec: TestSpec, failure: string, opts: RunTestsOptions, hooks: TestHooks, setup: SetupRunner | undefined, signal?: AbortSignal): Promise<SecondLook> {
  if (signal?.aborted) return { verdict: "unsure", reason: "The check was stopped." };
  const onFrame = (p: string) => hooks.onFrame?.(spec.id, p) ?? Promise.resolve();
  try {
    return await afterSetup<SecondLook>(
      env,
      spec,
      setup,
      signal,
      true,
      (pre) => secondLook(env, spec, failure, { artifactsDir: opts.artifactsDir, pre, signal, onFrame }),
      () => ({ verdict: "unsure", reason: "The setup didn't finish this time, so the check couldn't start." }),
    );
  } catch (e) {
    return { verdict: "unsure", reason: `The check didn't finish: ${plain(e)}` };
  }
}

async function afterSetup<T>(
  env: Env,
  spec: TestSpec,
  setup: SetupRunner | undefined,
  signal: AbortSignal | undefined,
  quiet: boolean,
  run: (pre: Prepared) => Promise<T>,
  noSetup: (outcome: SetupTestOutcome) => T,
): Promise<T> {
  if (!setup) return run({});
  // Before each test: the pin also takes back what the setup did on forks.
  const restore = setup.when() === "each" ? await pin(env) : undefined;
  try {
    const p = await setup.prepare(spec, signal, quiet);
    return "outcome" in p ? noSetup(p.outcome) : await run(p.pre);
  } finally {
    await restore?.();
  }
}

async function runHappy(env: Env, spec: TestSpec, opts: RunTestsOptions, hooks: TestHooks, pre: Prepared, signal?: AbortSignal): Promise<TestOutcome> {
  const result = TestRunResult.parse({ setup: pre.setup, steps: spec.steps.map(() => ({ status: "pending" })) });
  const steps = spec.steps.map((s) => ({ ...s }));
  const after = (spec.after ?? []).map((s) => ({ ...s }));
  const progress = () => hooks.onProgress?.(spec.id, result);
  const live = env.chains.configs().some((c) => c.mode === "live");
  let status: TestRunStatus = "pass";

  const restore = await pin(env);
  const reviews: SigningReview[] = [...(pre.reviews ?? [])];
  const session = await openSession(env, opts.artifactsDir, (p) => hooks.onFrame?.(spec.id, p) ?? Promise.resolve(), { storageState: pre.storageState }).catch(async (e) => {
    await restore();
    throw e;
  });

  try {
    // A page that doesn't open is the app's until a second look says otherwise.
    const opened = await session.page.goto(urlOnApp(spec.startPath, env.target.url), { waitUntil: "domcontentloaded", timeout: 45_000 }).then(
      () => undefined,
      (e) => (signal?.aborted ? Promise.reject(e) : plain(e)),
    );
    const blocked = opened === undefined ? await landingBotCheck(session) : undefined;
    if (blocked) throw new BlockedError(blocked);
    // A live account's figures differ on every run: what the expected result is about is noted before anything changes it.
    if (opened === undefined && live) result.before = await readBaseline(session, env.fastLlm(), spec).catch(() => undefined);

    const walk = opened === undefined ? await walkSteps(env, session, spec, steps, result.steps, reviews, { ...opts, signal, progress }) : { failure: `The page didn't open: ${opened}`, stuck: false };
    if (walk.failure) {
      // Stuck: the step couldn't be done as written, which is the test's to fix.
      status = walk.stuck ? "error" : "fail";
      if (walk.stuck) result.blame = "input";
      result.failure = walk.failure;
      for (const s of result.steps) if (s.status === "pending" || s.status === "running") s.status = "skipped";
    }

    if (status === "pass") {
      const v = await judgeExpected(session, env.fastLlm(), spec, { live, before: result.before, seen: result.steps.map((s) => s.note) });
      result.verdict = { ok: v.ok, reason: v.reason };
      if (!v.ok) {
        // On a fork the result may be there and the page unable to see it: its backends follow the real chain.
        const blind = live ? [] : blindHosts(session.wallet.requests(), (key) => session.traffic.hostsTold(key), session.backendsAnswered);
        status = blind.length ? "error" : "fail";
        if (blind.length) result.blame = "input";
        result.failure = `The expected result didn't show: ${v.reason}${blind.length ? ` ${forkUnseenLine(blind)}` : ""}`;
      }
      // What the test left on a live account is put back, whatever the verdict; it never changes the result.
      if (live && spec.after?.length) {
        const cleanup = TestRunResult.parse({ steps: spec.after.map(() => ({ status: "pending" })) }).steps;
        result.after = cleanup;
        await progress();
        const w = await walkSteps(env, session, { ...spec, steps: spec.after }, after, cleanup, reviews, { ...opts, signal, progress, shotPrefix: "after" }).catch((e) => ({ failure: plain(e) }));
        for (const s of cleanup) if (s.status === "pending" || s.status === "running") s.status = "skipped";
        if (w.failure) await env.log(`Cleanup after “${spec.name}” didn't finish: ${w.failure}`, "warn");
      }
    }
  } catch (e) {
    status = signal?.aborted ? "stopped" : "error";
    if (!signal?.aborted) Object.assign(result, broke(e));
    for (const s of result.steps) if (s.status === "pending" || s.status === "running") s.status = "skipped";
  } finally {
    result.finalScreenshot = await session.screenshot("final").catch(() => undefined);
    result.walletRequests = [...(pre.walletRequests ?? []), ...session.wallet.requests()];
    // The page broadcast a transaction our wallet never signed: the app's own signer paid, and our review and balance saw none of it.
    if (live && !result.walletRequests.some((r) => r.kind === "sign") && session.rpc.some((e) => e.via === "page" && e.method === "eth_sendRawTransaction")) result.embeddedSigner = true;
    result.console = session.console.filter((c) => c.level === "error" || c.level === "pageerror").slice(-50);
    result.signingReviews = reviews;
    result.video = (await session.close().catch(() => ({}) as { video?: string })).video;
    await restore();
  }
  if (status === "stopped") return { testId: spec.id, status, result };
  return { testId: spec.id, status, result, steps, ...(result.after ? { after } : {}) };
}

/**
 * Backends that could keep a fork's transaction from showing on the page: the ones the page told
 * about a transaction it sent here, or that reported the wallet's holdings from the real chain.
 * Nothing when no transaction was sent: then the page had nothing to miss.
 */
export function blindHosts(requests: WalletRequest[], hostsTold: (key: string) => string[], answered: readonly string[]): string[] {
  const hashes = requests.filter((r) => r.kind === "sign" && r.outcome === "approved" && typeof r.result === "string" && /^0x[0-9a-f]{64}$/i.test(r.result)).map((r) => r.result as string);
  if (hashes.length === 0) return [];
  return [...new Set([...hashes.flatMap(hostsTold), ...answered])];
}

/** What a thrown error says: a bot check is the owner's to get past, anything else broke on our side. */
function broke(e: unknown): { failure: string; blame: Blame } {
  return e instanceof BlockedError ? { failure: `Blocked: ${e.blocked.reason}`, blame: "input" } : { failure: plain(e), blame: "ours" };
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
      if (b.status === "stopped") return { testId: spec.id, status: "stopped", baseSteps, result: TestRunResult.parse({ setup: pre.setup }) };
      // Waiting for its test, unless what stopped the test was ours.
      const blame: Blame = b.result.blame === "ours" ? "ours" : "base";
      return { testId: spec.id, status: "error", baseSteps, result: TestRunResult.parse({ setup: pre.setup, blame, failure: `“${base.name}” has to pass first. ${b.result.failure ?? ""}`.trim() }) };
    }
    source = { ...base, steps: b.steps };
  }

  // Each action remembers which step it belongs to, so results map back onto the steps.
  const actions: Step[] = [];
  const owner: number[] = [];
  source.steps.forEach((s, i) => s.actions?.forEach((a) => (actions.push(a), owner.push(i))));

  const restore = await pin(env);
  let run: ConditionRun | undefined;
  let issues: TestRunResult["issues"] = [];
  let reviews: SigningReview[] = [];
  try {
    const r = await runEdgeCases({
      target: env.target,
      chains: env.chains,
      script: scriptOf(source, actions),
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
    if (signal?.aborted) return { testId: spec.id, status: "stopped", baseSteps, result: TestRunResult.parse({ setup: pre.setup }) };
    return { testId: spec.id, status: "error", baseSteps, result: TestRunResult.parse({ setup: pre.setup, ...broke(e) }) };
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
    // A condition run that errors is our replay breaking, not the app.
    blame: status === "error" ? "ours" : undefined,
    walletRequests: [...(pre.walletRequests ?? []), ...run.walletRequests],
    signingReviews: [...(pre.reviews ?? []), ...reviews],
    issues,
    console: run.console.filter((c) => c.level === "error" || c.level === "pageerror").slice(-50),
    video: run.video,
    finalScreenshot: run.finalScreenshot,
  });
  return { testId: spec.id, status, result, baseSteps };
}
