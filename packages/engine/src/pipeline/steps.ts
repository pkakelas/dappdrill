/** Going through a test's plain-English steps in an open session; shared by tests and the app's setup. */
import { newId, type AppMap, type Blocked, type DrillEvent, type ReplayScript, type SigningReview, type Step, type TestSpec, type TestStep, type TestStepResult, type WalletRequest } from "@dappdrill/core";
import { runStep } from "../agent/tester.js";
import { detectBotCheck } from "../browser/access.js";
import { createSession, replayScript, type EngineSession, type SessionOptions } from "../runtime.js";
import type { Env } from "./env.js";

export const debug = (m: string) => {
  if (process.env.DAPPDRILL_DEBUG) console.error(`[engine] ${m}`);
};

/** A session whose live frames go to `onFrame`. */
export function openSession(env: Env, artifactsDir: string, onFrame: ((path: string) => Promise<void>) | undefined, extra: Partial<SessionOptions> = {}): Promise<EngineSession> {
  return createSession(env.target, env.chains, {
    artifactsDir,
    headless: env.headless,
    runId: newId("run"),
    log: debug,
    sink: async (e: DrillEvent) => {
      if (e.type === "frame") await onFrame?.(e.path);
      else if (e.type === "log" && e.level !== "info") await env.sink(e);
    },
    ...extra,
  });
}

export interface WalkOptions {
  artifactsDir: string;
  map?: AppMap;
  baselines?: Record<string, SigningReview>;
  signal?: AbortSignal;
  /** Screenshot names start with this ("step" → step1.png). */
  shotPrefix?: string;
  /** After each step starts and passes. */
  progress?: () => Promise<void> | undefined;
}

/**
 * Does each step in turn: cached actions first, the fast model when they break.
 * Fills `results` and `steps` (with the actions that worked) as it goes, so a
 * stop or a crash keeps what was learned. Returns why a step failed.
 */
export async function walkSteps(
  env: Env,
  session: EngineSession,
  spec: TestSpec,
  steps: TestStep[],
  results: TestStepResult[],
  reviews: SigningReview[],
  opts: WalkOptions,
): Promise<{ failure?: string; stuck?: boolean }> {
  const { signal } = opts;
  const beforeApprove = async (request: WalletRequest) => {
    const screenshot = await session.screenshot(`sign-${request.id}`);
    const review = await env.reviewer
      .review({ request, chains: env.chains, ui: { buttonLabel: session.lastClickedLabel(), pageUrl: session.page.url(), screenshot }, baselines: opts.baselines ?? {}, artifactsDir: opts.artifactsDir })
      .catch((e) => debug(`signing review failed: ${e instanceof Error ? e.message : e}`));
    if (review) reviews.push(review);
  };
  const replay = async (actions: Step[]) => {
    const r = await replayScript(session, scriptOf(spec, actions), { here: true, reviewer: env.reviewer, baselines: opts.baselines, inbox: env.inbox, signal, log: debug });
    reviews.push(...r.signingReviews);
    return { ok: r.completed, error: r.error };
  };

  for (const [i, step] of spec.steps.entries()) {
    if (signal?.aborted) throw new Error("stopped");
    results[i]!.status = "running";
    await opts.progress?.();
    session.touch();
    const t0 = Date.now();
    const out = await runStep(
      { session, fast: env.fastLlm(), strong: env.actLlm(), map: opts.map, inbox: env.inbox, replay, beforeApprove, walletBackends: () => session.traffic.hostsTold(session.wallet.address()), signal },
      { ...spec, steps },
      i,
    );
    if (out.blocked) throw new BlockedError(out.blocked);
    if (out.actions) steps[i] = { text: step.text, actions: out.actions };
    results[i] = {
      status: out.ok ? "pass" : "fail",
      via: out.via,
      did: out.did,
      note: out.note,
      screenshot: await session.screenshot(`${opts.shotPrefix ?? "step"}${i + 1}`),
      durationMs: Date.now() - t0,
    };
    if (!out.ok) {
      for (const later of results.slice(i + 1)) later.status = "skipped";
      // A server that refused something while the step ran, in its own words, names who said no.
      const refused = session.traffic.refusedSince(t0);
      return { failure: `Step ${i + 1}, “${step.text}”: ${out.note ?? "didn't work"}${refused.length ? ` (${refused.join("; ")})` : ""}`, stuck: out.stuck };
    }
    await opts.progress?.();
  }
  return {};
}

export function scriptOf(spec: Pick<TestSpec, "id" | "name" | "startPath">, steps: Step[]): ReplayScript {
  return { id: spec.id, name: spec.name, origin: "described", startUrl: spec.startPath, params: [], steps };
}

export class BlockedError extends Error {
  constructor(readonly blocked: Blocked) {
    super(blocked.reason);
  }
}

export function plain(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
}

/** Challenges often load a moment after the page; look twice before calling the page clean. */
export async function landingBotCheck(session: EngineSession): Promise<Blocked | undefined> {
  const first = await detectBotCheck(session.page);
  if (first) return first;
  await session.page.waitForTimeout(2_500);
  return detectBotCheck(session.page);
}
