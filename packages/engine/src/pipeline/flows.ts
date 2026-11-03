/**
 * Running saved flows: setup flows first (a deposit before a withdraw), then
 * the edge-case matrix, then signing issues. Fork state is pinned around each
 * flow so flows never see each other's transactions.
 */
import { newId, nowIso, type EdgeCaseId, type Flow, type FlowRun, type Issue, type SigningReview, type Variation } from "@dappdrill/core";
import { createSession, replayFlow, runEdgeCases, type EngineSession } from "../runtime.js";
import type { Env } from "./env.js";
import { signingIssues } from "./signing-issues.js";

export interface FlowResult {
  runs: FlowRun[];
  issues: Issue[];
  signingReviews: SigningReview[];
}

export interface DrillFlowOptions {
  edgeCases: EdgeCaseId[];
  variation?: Variation;
  artifactsDir: string;
  baselines: Record<string, SigningReview>;
  video?: boolean;
  /** Ask the model whether the app recovered (scans only; replays stay model-free). */
  judge?: boolean;
  signal?: AbortSignal;
}

const debug = (m: string) => {
  if (process.env.DAPPDRILL_DEBUG) console.error(`[engine] ${m}`);
};

/** Snapshot every fork; the returned function reverts to it. No-op on live chains. */
export async function pin(env: Env): Promise<() => Promise<void>> {
  const snaps: [number, string][] = [];
  for (const c of env.chains.configs()) if (c.mode === "fork") snaps.push([c.id, await env.chains.snapshot(c.id)]);
  return async () => {
    for (const [id, snap] of snaps) await env.chains.revert(id, snap).catch(() => {});
  };
}

/** A session for setup and checks: no video, trace or live frames, and only warnings reach the sink. */
export function quietSession(env: Env, artifactsDir: string): Promise<EngineSession> {
  return createSession(env.target, env.chains, {
    artifactsDir,
    sink: (e) => (e.type === "log" && e.level !== "info" ? env.sink(e) : undefined),
    headless: env.headless,
    video: false,
    trace: false,
    frameIntervalMs: 0,
    log: debug,
  });
}

/** Replays the flow's setup flows in `session`. Returns a plain error when one breaks. */
export async function runSetup(session: EngineSession, flow: Flow, signal?: AbortSignal): Promise<string | undefined> {
  for (const s of flow.setup ?? []) {
    const r = await replayFlow(session, s, { signal, log: debug });
    if (!r.completed) return `Setup flow “${s.name}” didn't complete: ${r.error ?? "unknown error"}`;
  }
  return undefined;
}

/** Replays the flow once (setup included) on pinned state, without recording anything. */
export async function tryFlow(env: Env, flow: Flow, artifactsDir: string, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  const restore = await pin(env);
  const session = await quietSession(env, artifactsDir);
  try {
    const setupError = await runSetup(session, flow, signal);
    if (setupError) return { ok: false, error: setupError };
    const r = await replayFlow(session, flow, { signal, log: debug });
    return { ok: r.completed, error: r.error };
  } finally {
    await session.close().catch(() => {});
    await restore();
  }
}

/**
 * The explorer records flows one after another on the same chain, so a later
 * flow can depend on an earlier one (withdraw needs a deposit). Check the flow
 * on its own; if it breaks, find earlier flows that make it work.
 */
export async function findSetup(
  env: Env,
  flow: Flow,
  earlier: Flow[],
  artifactsDir: string,
  signal?: AbortSignal,
): Promise<{ ok: true; setup?: Flow["setup"] } | { ok: false; error?: string }> {
  const alone = await tryFlow(env, flow, artifactsDir, signal);
  if (alone.ok) return { ok: true };

  const withTx = earlier.filter((f) => f.steps.some((s) => s.kind === "wallet"));
  const candidates = withTx.slice(-3).reverse().map((f) => expand([f]));
  if (withTx.length > 1) candidates.push(expand(withTx));
  for (const setup of candidates) {
    if (signal?.aborted) break;
    if ((await tryFlow(env, { ...flow, setup }, artifactsDir, signal)).ok) return { ok: true, setup };
  }
  return { ok: false, error: alone.error };
}

/** Flows plus their own setup, flattened and de-duplicated, without nested setup. */
function expand(flows: Flow[]): NonNullable<Flow["setup"]> {
  const out = new Map<string, NonNullable<Flow["setup"]>[number]>();
  for (const f of flows) {
    for (const s of f.setup ?? []) out.set(s.id, s);
    const { setup: _, ...base } = f;
    out.set(f.id, base);
  }
  return [...out.values()];
}

/** One flow through the edge-case matrix, with its setup applied first. */
export async function drillFlow(env: Env, flow: Flow, opts: DrillFlowOptions): Promise<FlowResult> {
  const restore = flow.setup?.length ? await pin(env) : undefined;
  try {
    if (flow.setup?.length) {
      const session = await quietSession(env, opts.artifactsDir);
      const error = await runSetup(session, flow, opts.signal).finally(() => session.close().catch(() => {}));
      if (error) return await setupFailed(env, flow, error);
    }
    const result = await runEdgeCases({
      target: env.target,
      chains: env.chains,
      flow,
      edgeCases: opts.edgeCases,
      variation: opts.variation,
      reviewer: env.reviewer,
      judge: opts.judge ? env.judge() : undefined,
      inbox: env.inbox,
      sink: env.sink,
      artifactsDir: opts.artifactsDir,
      baselines: opts.baselines,
      headless: env.headless,
      video: opts.video,
      signal: opts.signal,
      log: debug,
    });
    const extra = signingIssues(flow, result.signingReviews, result.runs);
    for (const issue of extra) await env.sink({ type: "issue", issue });
    return { ...result, issues: [...result.issues, ...extra] };
  } finally {
    await restore?.();
  }
}

async function setupFailed(env: Env, flow: Flow, reason: string): Promise<FlowResult> {
  const at = nowIso();
  const run: FlowRun = {
    id: newId("run"),
    flowId: flow.id,
    edgeCase: "happy",
    status: "fail",
    reason,
    steps: [],
    walletRequests: [],
    signingReviewIds: [],
    issueIds: [],
    console: [],
    rpc: [],
    forkBlocks: {},
    mode: env.chains.configs().some((c) => c.mode === "live") ? "live" : "fork",
    startedAt: at,
    finishedAt: at,
  };
  await env.sink({ type: "run", run });
  await env.sink({ type: "flow-status", flowId: flow.id, status: "failed" });
  return { runs: [run], issues: [], signingReviews: [] };
}
