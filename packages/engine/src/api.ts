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
  type PlanItem,
  type ScanPlan,
  type ScanReport,
  type ScanStage,
  type SigningReview,
  blockedLine,
  stalledLine,
} from "@dappdrill/core";
import { generatePrivateKey } from "viem/accounts";
import { explore, proposeRepair, recordDescribedFlow, type ReplayFn } from "./agent/index.js";
import { detectBotCheck } from "./browser/access.js";
import { diagnoseStall } from "./browser/traffic.js";
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
/** Planned flows recorded at once, each in its own browser. */
const RECORD_LANES = 3;

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
  let blocked: ScanReport["blocked"];
  let stalled: ScanReport["stalled"];
  let plan: ScanPlan | undefined;
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
      // A challenge on the first page stops the scan before it spends anything on the model.
      blocked = await landingBotCheck(session);
      if (!blocked) {
        const explored = await explore(session, { think: env.thinkLlm(), act: env.actLlm() }, {
          maxFlows: opts.maxFlows,
          maxMinutes: opts.maxMinutes * EXPLORE_SHARE,
          depth: opts.depth,
          hints: opts.hints,
          knownFlows: opts.knownFlows,
          skip: opts.skipFlows,
          signal,
          inbox: env.inbox,
          lanes: RECORD_LANES,
          // New accounts, funded on the forks as the session opens, so lanes don't share balances or nonces.
          openLane: () =>
            createSession(
              { ...env.target, accounts: { A: generatePrivateKey(), B: generatePrivateKey() }, liveKey: undefined },
              env.chains,
              { artifactsDir: opts.artifactsDir, sink: exploreSink, headless: env.headless, video: false, trace: false, frameIntervalMs: 0, log: debug },
            ),
        });
        pages = explored.pages;
        if (explored.profile && explored.persona) {
          plan = { profile: explored.profile, persona: explored.persona, items: explored.plan.filter((p) => p.level <= opts.depth) };
        }
        flows.push(...explored.flows);
        blocked = explored.blocked;
        if (!blocked) await env.log(explored.summary);
      }
      const missing = env.chains.missing();
      if (blocked) {
        await env.log(blockedLine(blocked), "warn");
        await env.sink({ type: "blocked", blocked });
      } else if (missing.length || (flows.length === 0 && !signal?.aborted)) {
        // A chain the wallet couldn't add stops exploring wherever it's needed. Otherwise nothing
        // to test usually means the app's data never loaded; say what it was waiting on.
        const waiting = diagnoseStall(session.traffic, session.rpc, env.chains.configs().map((c) => c.id));
        stalled = missing.length ? { backends: [], rpc: [], ...waiting, chains: missing } : waiting;
        if (stalled) {
          await env.log(stalledLine(stalled), "warn");
          await env.sink({ type: "stalled", stalled });
        }
      }
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
        model: true,
        signal,
      });
      merge(result, r, env);
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
    // Includes chains the app asked for mid-scan, so replays start with them.
    chains: env.chains.configs(),
    pages,
    flows,
    ...result,
    costUsd: env.costUsd(),
    stoppedEarly: signal?.aborted ?? false,
    blocked,
    stalled,
    plan,
  };
}

/** Challenges often load a moment after the page; look twice before calling the page clean. */
async function landingBotCheck(session: EngineSession): Promise<ScanReport["blocked"]> {
  const first = await detectBotCheck(session.page);
  if (first) return first;
  await session.page.waitForTimeout(2_500);
  return detectBotCheck(session.page);
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
        env,
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
    const res = await recordDescribedFlow(session, env.actLlm(), description, {
      existing,
      replay: replayFn(env, session, options.artifactsDir, existing),
      inbox: env.inbox,
    });
    // An edited flow keeps its identity and setup.
    const flow = existing ? { ...res.flow, id: existing.id, origin: existing.origin, setup: existing.setup } : res.flow;
    return { flow, explanation: res.explanation };
  });
}

/**
 * Record one flow from a scan's plan again, with the user's hint. `setup` replays the
 * recorded flows it depends on first. Saves nothing: returns the flow, or why it failed.
 */
export async function retryFlow(
  target: DrillTarget,
  plan: Pick<ScanPlan, "profile" | "persona">,
  item: PlanItem,
  options: { artifactsDir: string; hint?: string; setup?: Flow[]; knownFlows?: { id: string; name: string }[]; headless?: boolean },
  sink: DrillEventSink,
  signal?: AbortSignal,
): Promise<{ flow?: Flow; item: PlanItem }> {
  const how = [
    item.how,
    item.note ? `An earlier attempt couldn't do it: ${item.note}.` : "",
    options.hint ? `Hint from the user: ${options.hint}` : "",
  ].filter(Boolean).join(" ");
  const setup = options.setup?.length ? { setup: options.setup } : undefined;
  return withAgentSession(target, options, sink, setup, async (env, session) => {
    const res = await explore(session, { think: env.thinkLlm(), act: env.actLlm() }, {
      plan: { ...plan, flows: [{ name: item.name, level: item.level, why: item.why, startPath: item.startPath, how, dependsOn: [] }] },
      maxFlows: 1,
      maxMinutes: 15,
      depth: 3,
      knownFlows: options.knownFlows,
      signal,
      inbox: env.inbox,
    });
    const outcome = res.plan[0] ?? { ...item, outcome: "not reached" as const, note: res.blocked?.reason ?? "it couldn't start" };
    return { flow: res.flows[0], item: { ...outcome, how: item.how, dependsOn: item.dependsOn } };
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
    const res = await proposeRepair(session, env.thinkLlm(), flow, failed, { replay: replayFn(env, session, options.artifactsDir, flow) });
    return res && { flow: { ...res.flow, id: flow.id, setup: flow.setup }, explanation: res.explanation };
  });
}

/** A recorded session on pinned state, with the flow's setup already run, for describe and repair. */
async function withAgentSession<T>(
  target: DrillTarget,
  options: { artifactsDir: string; headless?: boolean },
  sink: DrillEventSink,
  flow: Pick<Flow, "setup"> | undefined,
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

function merge(into: ReplayResult, from: ReplayResult, env: Env): void {
  into.issues.push(...from.issues.filter((i) => !env.isDuplicate(i)));
  into.runs.push(...from.runs.map(env.canonical));
  into.signingReviews.push(...from.signingReviews);
}

export type { Llm };
