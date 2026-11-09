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
  /** The setup's steps with the actions that worked, to save. */
  onSetupSteps?(steps: TestStep[]): Promise<void>;
}

interface SetupRun {
  ok: boolean;
  stopped: boolean;
  results: TestStepResult[];
  steps: TestStep[];
  failure?: string;
  /** Whose move a failed setup is: ours when something of ours broke, otherwise the owner's. */
  blame?: Blame;
  storageState?: string;
  reviews: SigningReview[];
  walletRequests: WalletRequest[];
}

const GOAL = "Get the app ready before a test: do what every test needs first, like signing in or getting test funds.";

/** `ready`: what a runner on another fork of the same block already prepared (see `portable`), used instead of running the setup here. */
export function setupRunner(env: Env, initial: AppSetup, opts: Omit<WalkOptions, "signal" | "progress" | "shotPrefix">, hooks: SetupHooks, ready?: Prepared) {
  let setup = initial;
  let once: SetupRun | undefined;
  let passedBefore = false;
  let runs = 0;
  let tests = 0;
  let dir: string | undefined;
  const live = env.chains.configs().some((c) => c.mode !== "fork");

  const summary = (r: SetupRun, reused: boolean, shared: boolean): SetupRunResult => ({ ok: r.ok, steps: r.results, when: setup.when, reused, shared });

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
        dir: (dir ??= await mkdtemp(path.join(tmpdir(), "dappdrill-setup-"))),
        n: ++runs,
        onFrame: (p) => hooks.onFrame?.(spec.id, p) ?? Promise.resolve(),
        progress: (results) => (quiet ? undefined : hooks.onProgress?.(spec.id, { ...pending, setup: { ok: false, steps: results, when: setup.when, reused: false, shared } })),
      });
      const learned = run.steps.some((s, i) => s.actions !== setup.steps[i]?.actions);
      setup = { ...setup, steps: run.steps };
      if (learned) await hooks.onSetupSteps?.(run.steps);
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
  opts: Omit<WalkOptions, "progress" | "shotPrefix"> & { dir: string; n: number; onFrame: (path: string) => Promise<void>; progress: (results: TestStepResult[]) => Promise<void> | undefined },
): Promise<SetupRun> {
  const spec: TestSpec = { id: "setup", name: "Setup", goal: GOAL, expected: "The app is ready to use.", startPath: setup.startPath, steps: setup.steps };
  const steps = setup.steps.map((s) => ({ ...s }));
  const results: TestStepResult[] = setup.steps.map(() => ({ status: "pending", did: [], durationMs: 0 }));
  const reviews: SigningReview[] = [];
  const run: SetupRun = { ok: false, stopped: false, results, steps, reviews, walletRequests: [] };
  const session = await openSession(env, opts.artifactsDir, opts.onFrame, { video: false, trace: false });
  try {
    await session.page.goto(urlOnApp(setup.startPath, env.target.url), { waitUntil: "domcontentloaded", timeout: 45_000 });
    const blocked = await landingBotCheck(session);
    if (blocked) throw new BlockedError(blocked);
    const walk = await walkSteps(env, session, spec, steps, results, reviews, { ...opts, shotPrefix: "setup-step", progress: () => opts.progress(results) });
    if (walk.failure) run.failure = walk.failure;
    else {
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
