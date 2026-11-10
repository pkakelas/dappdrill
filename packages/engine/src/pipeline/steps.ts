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
  /**
   * Steps whose failure is told rather than fatal (the reset): the fast model gets more turns
   * and the acting model never takes over, since many a small action is the usual shape there.
   */
  bestEffort?: boolean;
}

/** Turns the fast model gets on a best-effort step: enough to cancel a list of orders one by one. */
const BEST_EFFORT_TURNS = 30;

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
      {
        session,
        fast: env.fastLlm(),
        strong: opts.bestEffort ? undefined : env.actLlm(),
        turns: opts.bestEffort ? BEST_EFFORT_TURNS : undefined,
        map: opts.map,
        inbox: env.inbox,
        replay,
        beforeApprove,
        walletBackends: () => session.traffic.hostsTold(session.wallet.address()),
        signal,
      },
      { ...spec, steps },
      i,
    );
    if (out.blocked) throw new BlockedError(out.blocked);
    // A path that skips something the recorded one did by name isn't the step done another way,
    // so it doesn't replace the recording: the next run tries the recorded path again. Nor is one
    // that signs where the recorded one didn't: that is an earlier step's work done over. And a
    // path with nothing in it (the step was already true) would make the step a no-op for good.
    const skipped = out.actions && step.actions ? skippedBy(step.actions, out.actions) : undefined;
    const signed = out.actions && step.actions && !step.actions.some((a) => a.kind === "wallet") && out.actions.some((a) => a.kind === "wallet");
    const kept = skipped ? `Done without “${skipped}”, which the recorded steps did; the recording is kept.` : signed ? "Signed with the wallet where the recorded steps didn't; the recording is kept." : undefined;
    if (out.actions?.length && !kept) steps[i] = { text: step.text, actions: out.actions };
    results[i] = {
      status: out.ok ? "pass" : "fail",
      via: out.via,
      did: out.did,
      note: kept ? [out.note, kept].filter(Boolean).join(" ") : out.note,
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

/**
 * The first thing the recorded path did by name (a click, an entry, a signature) that the new one
 * doesn't. A doing of the same kind under a new name in its place is the control renamed
 * ("Deposit" became "Add funds"), not a skip.
 */
export function skippedBy(recorded: Step[], taken: Step[]): string | undefined {
  const was = doings(recorded);
  const known = new Set(was.map((d) => d.key));
  const done = new Set<string>();
  const renamed: Record<string, number> = {};
  for (const d of doings(taken)) {
    if (known.has(d.key)) done.add(d.key);
    else renamed[d.kind] = (renamed[d.kind] ?? 0) + 1;
  }
  for (const d of was) {
    if (done.has(d.key)) continue;
    if (renamed[d.kind]) renamed[d.kind]!--;
    else return d.name;
  }
  return undefined;
}

function doings(actions: Step[]): { key: string; kind: string; name: string }[] {
  const out: { key: string; kind: string; name: string }[] = [];
  for (const a of actions) {
    if (a.kind === "wallet") out.push({ key: "wallet", kind: "wallet", name: a.note ?? "the wallet request" });
    else if (a.kind === "click" || a.kind === "fill" || a.kind === "select") {
      const name = a.target.name ?? a.target.label ?? a.target.text ?? a.target.placeholder ?? a.target.near;
      if (name) out.push({ key: `${a.kind}:${name.toLowerCase()}`, kind: a.kind, name });
    }
  }
  return out;
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
