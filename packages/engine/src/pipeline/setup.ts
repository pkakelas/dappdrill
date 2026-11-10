/**
 * The app's setup: steps every test needs first (sign in, get test funds).
 *
 * once: it runs before the first test of the run and its browser storage is
 * saved; each test then starts from that storage, and pin() around each test
 * brings forks back to the state setup left. each: it runs again before every
 * test, inside that test's pin, so forks also lose what it did afterwards.
 * Live chains can't be reverted, so there tests share whatever came before.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TestRunResult, type AppSetup, type Blame, type SetupRunResult, type SigningReview, type TestSpec, type TestStep, type TestStepResult, type WalletRequest, urlOnApp } from "@dappdrill/core";
import { saveState } from "../browser/session.js";
import type { Env } from "./env.js";
import { BlockedError, landingBotCheck, openSession, plain, walkSteps, type WalkOptions } from "./steps.js";

/** What a test starts from. */
export interface Prepared {
  /** Browser storage saved after the setup. */
  storageState?: string;
  setup?: SetupRunResult;
  /** Signatures and requests the setup made when it ran just before this test. */
  reviews?: SigningReview[];
  walletRequests?: WalletRequest[];
}

export interface SetupTestOutcome {
  testId: string;
  status: "error" | "stopped";
  result: TestRunResult;
}

export interface SetupHooks {
  onProgress?(testId: string, result: TestRunResult): Promise<void>;
  onFrame?(testId: string, path: string): Promise<void>;
  /** The setup's steps, and its reset steps when it has them, with the actions that worked, to save. */
  onSetupSteps?(steps: TestStep[], reset?: TestStep[]): Promise<void>;
}

interface SetupRun {
  ok: boolean;
  stopped: boolean;
  results: TestStepResult[];
  steps: TestStep[];
  /** The reset steps and how they went, when they ran. */
  reset?: TestStep[];
  resetResults?: TestStepResult[];
  failure?: string;
  /** Whose move a failed setup is: ours when something of ours broke, otherwise the owner's. */
  blame?: Blame;
  storageState?: string;
  reviews: SigningReview[];
  walletRequests: WalletRequest[];
}

const GOAL = "Get the app ready before a test: do what every test needs first, like signing in or getting test funds.";
const RESET_GOAL = "Put the account back the way a new run expects it: nothing left open from earlier runs (orders, positions, pending actions). A step that finds nothing to undo is done.";

/** `ready`: what a runner on another fork of the same block already prepared (see `portable`), used instead of running the setup here. */
export function setupRunner(env: Env, initial: AppSetup, opts: Omit<WalkOptions, "signal" | "progress" | "shotPrefix">, hooks: SetupHooks, ready?: Prepared) {
  let setup = initial;
  let once: SetupRun | undefined;
  let passedBefore = false;
  let runs = 0;
  let tests = 0;
  let dir: string | undefined;
  const live = env.chains.configs().some((c) => c.mode !== "fork");

  const summary = (r: SetupRun, reused: boolean, shared: boolean): SetupRunResult => ({ ok: r.ok, steps: r.results, when: setup.when, reused, shared, ...(r.resetResults ? { reset: r.resetResults } : {}) });

  return {
    when: () => setup.when,

    /** Runs the setup for this test when it needs to; an outcome when the test can't run. Quiet: no progress, for a run that already has its result. */
    async prepare(spec: TestSpec, signal?: AbortSignal, quiet = false): Promise<{ pre: Prepared } | { outcome: SetupTestOutcome }> {
      // On a live chain every test after the first starts from what the earlier ones left.
      const shared = live && tests++ > 0;
      if (ready) return { pre: ready };
      if (setup.when === "once" && once) {
        if (!once.ok) return { outcome: failed(spec, summary(once, true, shared), once.blame, once.failure) };
        return { pre: { storageState: once.storageState, setup: summary(once, true, shared) } };
      }

      const pending = TestRunResult.parse({ steps: spec.steps.map(() => ({ status: "pending" })) });
      const run = await runSetup(env, setup, {
        ...opts,
        signal,
        live,
        dir: (dir ??= await mkdtemp(path.join(tmpdir(), "dappdrill-setup-"))),
        n: ++runs,
        onFrame: (p) => hooks.onFrame?.(spec.id, p) ?? Promise.resolve(),
        progress: (results, reset) => (quiet ? undefined : hooks.onProgress?.(spec.id, { ...pending, setup: { ok: false, steps: results, when: setup.when, reused: false, shared, ...(reset ? { reset } : {}) } })),
      });
      const learned = run.steps.some((s, i) => s.actions !== setup.steps[i]?.actions) || (run.reset?.some((s, i) => s.actions !== setup.reset?.[i]?.actions) ?? false);
      setup = { ...setup, steps: run.steps, ...(run.reset ? { reset: run.reset } : {}) };
      if (learned) await hooks.onSetupSteps?.(run.steps, run.reset);
      const result = summary(run, false, shared);
      if (run.stopped) return { outcome: { testId: spec.id, status: "stopped", result: TestRunResult.parse({ setup: result }) } };
      // A setup we broke gets another go before the next test.
      if (setup.when === "once" && run.blame !== "ours") once = run;
      if (!run.ok) {
        // A setup that worked earlier in this run and fails now often can't be repeated (a faucet limit).
        const hint = setup.when === "each" && passedBefore ? " It worked before an earlier test in this run, so it may not be repeatable: try running it once per run." : "";
        return { outcome: failed(spec, result, run.blame, `${run.failure ?? "it didn't finish"}${hint}`) };
      }
      passedBefore = true;
      return { pre: { storageState: run.storageState, setup: result, reviews: run.reviews, walletRequests: run.walletRequests } };
    },

    /**
     * What this setup prepared, for another runner of the same run to start from instead of
     * running it again. On forks only a setup that sent no transaction qualifies (a sign-in,
     * connecting the wallet): it left the chain as it found it, so its browser storage is just
     * as true on a fork it never ran on. A live chain is one chain for every runner, and what was
     * done there stays done: a second mint or a second emailed code is what a faucet limit is for.
     */
    portable(): Prepared | undefined {
      if (setup.when !== "once" || !once?.ok) return undefined;
      if (live) return { storageState: once.storageState, setup: summary(once, true, true) };
      const sent = once.walletRequests.some((r) => r.kind === "sign" && r.outcome === "approved" && /send/i.test(r.method));
      return sent ? undefined : { storageState: once.storageState, setup: summary(once, true, false) };
    },

    async close(): Promise<void> {
      // Saved storage holds the app's session cookies: never keep it past the run.
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export type SetupRunner = ReturnType<typeof setupRunner>;

function failed(spec: TestSpec, setup: SetupRunResult, blame: Blame = "input", why?: string): SetupTestOutcome {
  return {
    testId: spec.id,
    status: "error",
    result: TestRunResult.parse({ setup, steps: spec.steps.map(() => ({ status: "skipped" })), blame, failure: `Setup didn't finish. ${why ?? ""}`.trim() }),
  };
}

async function runSetup(
  env: Env,
  setup: AppSetup,
  opts: Omit<WalkOptions, "progress" | "shotPrefix"> & { live: boolean; dir: string; n: number; onFrame: (path: string) => Promise<void>; progress: (results: TestStepResult[], reset?: TestStepResult[]) => Promise<void> | undefined },
): Promise<SetupRun> {
  const spec: TestSpec = { id: "setup", name: "Setup", goal: GOAL, expected: "The app is ready to use.", startPath: setup.startPath, steps: setup.steps };
  const steps = setup.steps.map((s) => ({ ...s }));
  const results: TestStepResult[] = setup.steps.map(() => ({ status: "pending", did: [], durationMs: 0 }));
  const reviews: SigningReview[] = [];
  const run: SetupRun = { ok: false, stopped: false, results, steps, reviews, walletRequests: [] };
  // Only a live account carries leftovers; on a fork the reset would undo nothing.
  if (opts.live && setup.reset?.length) {
    run.reset = setup.reset.map((s) => ({ ...s }));
    run.resetResults = setup.reset.map(() => ({ status: "pending", did: [], durationMs: 0 }));
  }
  const session = await openSession(env, opts.artifactsDir, opts.onFrame, { video: false, trace: false });
  try {
    await session.page.goto(urlOnApp(setup.startPath, env.target.url), { waitUntil: "domcontentloaded", timeout: 45_000 });
    const blocked = await landingBotCheck(session);
    if (blocked) throw new BlockedError(blocked);
    const walk = await walkSteps(env, session, spec, steps, results, reviews, { ...opts, shotPrefix: "setup-step", progress: () => opts.progress(results, run.resetResults) });
    if (walk.failure) run.failure = walk.failure;
    else {
      // The account is put back once the setup is in; what it couldn't undo is said, and the tests go on from there.
      // Each reset step stands on its own: an order that won't cancel is no reason to leave a position open.
      if (run.reset && run.resetResults) {
        const undone: string[] = [];
        for (const [i, step] of run.reset.entries()) {
          if (opts.signal?.aborted) break;
          const resetSpec: TestSpec = { id: "reset", name: "Reset", goal: RESET_GOAL, expected: "Nothing from earlier runs is left open.", startPath: setup.startPath, steps: [step] };
          const one = [step];
          const its = [run.resetResults[i]!];
          const w = await walkSteps(env, session, resetSpec, one, its, reviews, { ...opts, shotPrefix: `reset-step${i + 1}-`, progress: () => opts.progress(results, run.resetResults) }).catch((e) => ({ failure: plain(e) }));
          run.reset[i] = one[0]!;
          run.resetResults[i] = its[0]!;
          if (w.failure) undone.push(w.failure.replace(/^Step 1, /, `Step ${i + 1}, `));
        }
        for (const r of run.resetResults) if (r.status === "pending" || r.status === "running") r.status = "skipped";
        if (undone.length) await env.log(`The reset didn't finish, so tests start with some of what earlier runs left: ${undone.join(" ")}`, "warn");
      }
      run.storageState = path.join(opts.dir, `state-${opts.n}.json`);
      await saveState(session, run.storageState);
      run.ok = true;
    }
  } catch (e) {
    run.stopped = Boolean(opts.signal?.aborted);
    run.failure = e instanceof BlockedError ? `Blocked: ${e.blocked.reason}` : plain(e);
    if (!(e instanceof BlockedError)) run.blame = "ours";
    for (const r of results) if (r.status === "pending" || r.status === "running") r.status = "skipped";
  } finally {
    run.walletRequests = session.wallet.requests();
    await session.close().catch(() => {});
  }
  return run;
}
