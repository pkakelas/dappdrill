/**
 * Public engine API. The worker and the CLI only use these functions, so the
 * engine runs the same with or without a database.
 */
import {
  DrillTarget,
  ReplayOptions,
  ScanOptions,
  nowIso,
  type DrillEvent,
  type DrillEventSink,
  type EdgeCaseId,
  type Flow,
  type FlowRun,
  type Issue,
  type ScanReport,
  type ScanStage,
  type SigningReview,
} from "@dappdrill/core";
import { explore, proposeRepair, recordDescribedFlow, type ReplayFn } from "./agent/index.js";
import { openEnv, type Env } from "./pipeline/env.js";
import { drillFlow, findSetup, pin, runSetup, tryFlow } from "./pipeline/flows.js";
import { createSession, replayFlow, type EngineSession } from "./runtime.js";
import type { Llm } from "./types.js";

export interface ReplayResult {
  runs: FlowRun[];
  issues: Issue[];
  signingReviews: SigningReview[];
}

/** Share of the scan budget the explorer gets; the rest goes to replays and edge cases. */
const EXPLORE_SHARE = 0.6;

const debug = (m: string) => {
  if (process.env.DAPPDRILL_DEBUG) console.error(`[engine] ${m}`);
};

/** Discovery scan: map pages, find flows, run the edge-case matrix, review signatures. */
export async function scan(
  input: DrillTarget,
  options: ScanOptions,
  sink: DrillEventSink,
  signal?: AbortSignal,
): Promise<ScanReport> {
  const opts = ScanOptions.parse(options);
  const startedAt = nowIso();
  const stage = (stage: ScanStage, status: "running" | "done", progress: number) => sink({ type: "stage", stage, status, progress });

  await stage("map", "running", 0);
  const env = await openEnv(DrillTarget.parse(input), sink, { headless: opts.headless });
  const result: ReplayResult = { runs: [], issues: [], signingReviews: [] };
  let pages: ScanReport["pages"] = [];
  const flows: Flow[] = [];
  try {
    // 1. Explore on pinned state, so what the model did doesn't leak into the tests.
    let flowsStarted = false;
    const exploreSink: DrillEventSink = async (event: DrillEvent) => {
      if (event.type === "flow" && !flowsStarted) {
        flowsStarted = true;
        await stage("map", "done", 1);
        await stage("flows", "running", 0);
      }
      await env.sink(event);
    };
    const restore = await pin(env);
    const session = await createSession(env.target, env.chains, { artifactsDir: opts.artifactsDir, sink: exploreSink, headless: env.headless, log: debug });
    try {
      await env.log(`Opening ${env.target.url}`);
      await session.page.goto(env.target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const explored = await explore(session, env.llm(), {
        maxFlows: opts.maxFlows,
        maxMinutes: opts.maxMinutes * EXPLORE_SHARE,
        hints: opts.hints,
        signal,
        inbox: env.inbox,
      });
      pages = explored.pages;
      flows.push(...explored.flows);
      if (explored.blocked) await env.log(`Stopped exploring: ${explored.blocked}`, "warn");
    } finally {
      await session.close().catch(() => {});
      await restore();
    }
    if (!flowsStarted) {
      await stage("map", "done", 1);
      await stage("flows", "running", 0);
    }

    // 2. Every flow must replay without the model; earlier flows become setup when needed.
    const replayable = new Set<string>();
    for (const [i, flow] of flows.entries()) {
      if (signal?.aborted) break;
      const check = await findSetup(env, flow, flows.slice(0, i).filter((f) => replayable.has(f.id)), opts.artifactsDir, signal);
      if (check.ok) {
        replayable.add(flow.id);
        if (check.setup) {
          flows[i] = { ...flow, setup: check.setup };
          await env.sink({ type: "flow", flow: flows[i]! });
          await env.log(`“${flow.name}” needs ${check.setup.map((s) => `“${s.name}”`).join(" and ")} first; tests run that before it`);
        }
        await env.sink({ type: "flow-status", flowId: flow.id, status: "queued" });
      } else {
        await env.log(`“${flow.name}” worked while exploring but not on replay: ${check.error ?? "unknown error"}`, "warn");
      }
      await stage("flows", "running", (i + 1) / flows.length);
    }
    await stage("flows", "done", 1);

    // 3. The edge-case matrix, with signing reviews on every request.
    await stage("edge-cases", "running", 0);
    await stage("signing", "running", 0);
    const edgeCases = withHappy(env.target.edgeCases);
    for (const [i, flow] of flows.entries()) {
      if (signal?.aborted) break;
      await env.log(`Testing “${flow.name}”`);
      const r = await drillFlow(env, flow, {
        // A flow that doesn't replay only gets the happy path, which records how it breaks.
        edgeCases: replayable.has(flow.id) ? edgeCases : ["happy"],
        artifactsDir: opts.artifactsDir,
        baselines: opts.baselines,
        judge: true,
        signal,
      });
      merge(result, r);
      await stage("edge-cases", "running", (i + 1) / flows.length);
      await stage("signing", "running", (i + 1) / flows.length);
    }
    await stage("edge-cases", "done", 1);
    await stage("signing", "done", 1);
    await env.sink({ type: "cost", usd: env.costUsd() });
  } finally {
    await env.close();
  }

  return {
    url: env.target.url,
    startedAt,
    finishedAt: nowIso(),
    chains: env.target.chains,
    pages,
    flows,
    ...result,
    costUsd: env.costUsd(),
    stoppedEarly: signal?.aborted ?? false,
  };
}

/** Deterministic replay of saved flows under the given edge cases. No model calls unless a step breaks. */
export async function replay(
  target: DrillTarget,
  flows: Flow[],
  options: ReplayOptions,
  sink: DrillEventSink,
  signal?: AbortSignal,
): Promise<ReplayResult> {
  const opts = ReplayOptions.parse(options);
  const env = await openEnv(DrillTarget.parse(target), sink, { headless: opts.headless });
  const result: ReplayResult = { runs: [], issues: [], signingReviews: [] };
  try {
    for (const flow of flows) await sink({ type: "flow-status", flowId: flow.id, status: "queued" });
    for (const flow of flows) {
      if (signal?.aborted) break;
      merge(
        result,
        await drillFlow(env, flow, {
          edgeCases: opts.edgeCases,
          variation: opts.variation,
          artifactsDir: opts.artifactsDir,
          baselines: opts.baselines,
          video: opts.video,
          signal,
        }),
      );
    }
  } finally {
    await env.close();
  }
  return result;
}

/** Turn a plain-English description into a recorded flow by doing it on the site. */
export async function describeFlow(
  target: DrillTarget,
  description: string,
  options: { artifactsDir: string; existing?: Flow; headless?: boolean },
  sink: DrillEventSink,
): Promise<{ flow: Flow; explanation: string }> {
  const { existing } = options;
  return withAgentSession(target, options, sink, existing, async (env, session) => {
    const res = await recordDescribedFlow(session, env.llm(), description, {
      existing,
      replay: replayFn(env, session, options.artifactsDir, existing),
      inbox: env.inbox,
    });
    // An edited flow keeps its identity and setup.
    const flow = existing ? { ...res.flow, id: existing.id, origin: existing.origin, setup: existing.setup } : res.flow;
    return { flow, explanation: res.explanation };
  });
}

/** Propose a fix for a flow whose replay broke. Returns null when it can't find one. */
export async function repairFlow(
  target: DrillTarget,
  flow: Flow,
  failed: FlowRun,
  options: { artifactsDir: string; headless?: boolean },
  sink: DrillEventSink,
): Promise<{ flow: Flow; explanation: string } | null> {
  return withAgentSession(target, options, sink, flow, async (env, session) => {
    const res = await proposeRepair(session, env.llm(), flow, failed, { replay: replayFn(env, session, options.artifactsDir, flow) });
    return res && { flow: { ...res.flow, id: flow.id, setup: flow.setup }, explanation: res.explanation };
  });
}

/** A recorded session on pinned state, with the flow's setup already run, for describe and repair. */
async function withAgentSession<T>(
  target: DrillTarget,
  options: { artifactsDir: string; headless?: boolean },
  sink: DrillEventSink,
  flow: Flow | undefined,
  work: (env: Env, session: EngineSession) => Promise<T>,
): Promise<T> {
  const env = await openEnv(DrillTarget.parse(target), sink, { headless: options.headless });
  const restore = await pin(env);
  const session = await createSession(env.target, env.chains, { artifactsDir: options.artifactsDir, sink: env.sink, headless: env.headless, log: debug });
  try {
    const setupError = flow ? await runSetup(session, flow) : undefined;
    if (setupError) throw new Error(setupError);
    if (!flow) await session.page.goto(env.target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return await work(env, session);
  } finally {
    await session.close().catch(() => {});
    await restore();
    await env.close();
  }
}

/**
 * Model-free replay for the agent. A partial replay continues in the agent's
 * session; a full one verifies a proposal on its own pinned state.
 */
function replayFn(env: Env, session: EngineSession, artifactsDir: string, original?: Flow): ReplayFn {
  return async (flow, { upToStep, inputs }) => {
    if (upToStep === undefined) {
      const r = await tryFlow(env, { ...flow, setup: flow.setup ?? original?.setup }, artifactsDir);
      return { ok: r.ok, error: r.error };
    }
    const r = await replayFlow(session, { ...flow, steps: flow.steps.slice(0, upToStep) }, { params: inputs, log: debug });
    return { ok: r.completed, failedStep: r.steps.find((s) => s.status === "fail")?.index, error: r.error };
  };
}

function withHappy(edgeCases: EdgeCaseId[]): EdgeCaseId[] {
  return edgeCases.includes("happy") ? edgeCases : ["happy", ...edgeCases];
}

function merge(into: ReplayResult, from: ReplayResult): void {
  into.runs.push(...from.runs);
  into.issues.push(...from.issues);
  into.signingReviews.push(...from.signingReviews);
}

export type { Llm };
