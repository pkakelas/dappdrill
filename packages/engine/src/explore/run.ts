/**
 * An exploration from start to finish: prove the wallet connects, plan the areas, explore them,
 * sort the checks, promote and prove tests, settle the bugs, and refuse to end with anything open.
 */
import { closeGate, nowIso, type AppSetup, type Blocked, type ChainConfig, type CheckReplay, type DrillEventSink, type DrillTarget, type ExploreArea, type ExploreState, type TestSpec, type TestStep } from "@dappdrill/core";
import { openEnv, withoutFallback } from "../pipeline/env.js";
import { setupRunner } from "../pipeline/setup.js";
import { plain } from "../pipeline/steps.js";
import { regressionCandidates, reproduceBugs, reviewBugs } from "./bugs.js";
import { runExplorer } from "./explorer.js";
import { areaBudgetMs, decideProposals, deeperAreas, explorerId, planAreas } from "./plan.js";
import { extractChecks, promoteFlow } from "./promote.js";
import { proveCandidates } from "./prove.js";
import { ExploreRun, type ExploreHooks, type ExploreOptions } from "./run-context.js";

export type { ExploreHooks, ExploreOptions, KnownTest } from "./run-context.js";

export interface ExploreOutput {
  state: ExploreState;
  replays: CheckReplay[];
  blocked?: Blocked;
  chains: ChainConfig[];
  costUsd: number;
}

/** Below this nothing useful fits in a new area. */
const MIN_NEW_AREA_MS = 2 * 60_000;

const CONNECT: AppSetup = { startPath: "/", steps: [{ text: "Connect the wallet" }], when: "once" };

export async function runExploration(target: DrillTarget, opts: ExploreOptions, hooks: ExploreHooks, sink: DrillEventSink, signal?: AbortSignal): Promise<ExploreOutput> {
  const base = await openEnv(target, sink, { headless: opts.headless });
  const run = new ExploreRun(base, opts, hooks, sink, signal);
  const { board } = run;
  try {
    if (await preflight(run)) {
      await plan(run);
      await explore(run);
      await sort(run);
      if (!signal?.aborted && !run.blocked) await promote(run);
      if (!signal?.aborted && !run.blocked) {
        board.phase("proving", `Proving ${board.state.candidates.length} tests on fresh forks`);
        await proveCandidates(run);
      }
      if (!signal?.aborted) await confirm(run);
      if (!signal?.aborted) await close(run);
    }
    board.phase("done");
    await board.flush();
    return { state: board.state, replays: keptReplays(run), blocked: run.blocked, chains: withoutFallback(base.chains.configs()), costUsd: run.costUsd() };
  } finally {
    await run.baseRunner?.close();
    await base.close();
  }
}

const keptReplays = (run: ExploreRun) => run.board.state.checks.flatMap((c) => run.replays.get(c.id) ?? []);

/** The wallet has to work before anything is spent on exploring. */
async function preflight(run: ExploreRun): Promise<boolean> {
  const { base, board, opts, hooks, signal } = run;
  const real = opts.setup?.steps.length ? opts.setup : undefined;
  board.phase("setup", real ? "Running the app's setup" : "Checking the wallet connects");
  board.addExplorer({ id: "setup", title: real ? "Setup" : "Connecting the wallet", flow: "", tier: "critical", status: "running", doing: real?.steps[0]?.text ?? "Connecting the wallet", checks: 0, bugs: 0, startedAt: nowIso(), activeAt: nowIso() });
  let entry = real ?? CONNECT;
  const runner = setupRunner(base, entry, { artifactsDir: opts.artifactsDir, map: opts.map, baselines: opts.baselines }, {
    onFrame: async (_id, frame) => board.explorer("setup", { frame, activeAt: nowIso() }),
    onSetupSteps: async (steps: TestStep[]) => {
      entry = { ...entry, steps };
      if (real) await hooks.onSetupSteps?.(steps);
    },
  });
  run.baseRunner = runner;
  const spec: TestSpec = { id: "setup", name: "Setup", goal: "", expected: "", startPath: entry.startPath, steps: [] };
  const ready = await runner.prepare(spec, signal).catch((e) => ({ outcome: { result: { failure: plain(e) } } }));
  run.entry = entry;
  if ("outcome" in ready) {
    const why = ready.outcome.result.failure ?? "Setup didn't finish.";
    board.explorer("setup", { status: "failed", error: why, doing: undefined, finishedAt: nowIso() });
    board.change((s) => (s.stopped = real ? `The app's setup didn't work, so nothing was explored. ${why}` : `The wallet didn't connect, so nothing was explored. ${why}`));
    return false;
  }
  board.explorer("setup", { status: "done", doing: undefined, finishedAt: nowIso() });
  board.feed("pass", real ? "The app's setup works" : "The wallet connects");
  return true;
}

async function plan(run: ExploreRun): Promise<void> {
  const { base, board, opts } = run;
  board.phase("planning", "Deciding what matters most");
  const { flows, areas } = await planAreas(base.thinkLlm(), base.target.url, opts);
  const count = (t: string) => flows.filter((f) => f.tier === t).length;
  board.change((s) => {
    s.flows = flows;
    s.areas = areas;
  });
  board.feed("note", `${areas.length} areas across ${count("critical")} Critical, ${count("important")} Important and ${count("supporting")} Supporting flows`);
}

async function explore(run: ExploreRun): Promise<void> {
  const { base, board, opts, signal } = run;
  const totalMs = opts.budgetMinutes * 60_000;
  const deadline = Date.now() + totalMs;
  board.phase("exploring");
  board.change((s) => (s.deadline = new Date(deadline).toISOString()));

  const queue: ExploreArea[] = [...board.state.areas].sort((a, b) => rank(a) - rank(b));
  for (const a of queue) addQueued(run, a);
  const running = new Map<string, Promise<void>>();
  const left = () => deadline - Date.now();

  const start = (area: ExploreArea) => {
    const id = explorerId(area.id);
    const budget = Math.min(areaBudgetMs(area, board.state.areas, totalMs, run.slots), left());
    const job = run.withEnv((env) => runExplorer(run, env, area, id, budget))
      .catch((e) => board.explorer(id, { status: "failed", error: plain(e), doing: undefined, finishedAt: nowIso() }))
      .finally(() => running.delete(id));
    running.set(id, job);
  };

  for (;;) {
    const stop = signal?.aborted || run.blocked || left() < MIN_NEW_AREA_MS;
    if (!stop) {
      const accepted = await decideProposals(base.thinkLlm(), board.state, (fn) => board.change(fn)).catch(() => []);
      for (const a of accepted) add(run, queue, a);
      while (running.size < run.slots && queue.length) start(queue.shift()!);
      if (running.size === 0 && queue.length === 0) {
        const deeper = deeperAreas(board.state);
        if (deeper.length === 0) break;
        for (const a of deeper) add(run, queue, a);
        board.feed("note", `Time left: going deeper on ${deeper.map((a) => a.flow).join(", ")}`);
        continue;
      }
    } else if (running.size === 0) break;
    await Promise.race(running.values());
  }

  for (const a of queue) {
    board.explorer(explorerId(a.id), { status: "stopped", finishedAt: nowIso() });
    if (a.tier === "critical") board.change((s) => void s.gaps.push({ flow: a.flow, what: a.title, why: "Ran out of time before it started." }));
  }
  board.change((s) => void s.proposals.filter((p) => p.status === "open").forEach((p) => {
    p.status = "declined";
    p.note = "Ran out of time.";
  }));
}

const rank = (a: ExploreArea) => ({ critical: 0, important: 1, supporting: 2 })[a.tier];

function add(run: ExploreRun, queue: ExploreArea[], area: ExploreArea) {
  run.board.change((s) => void s.areas.push(area));
  queue.push(area);
  queue.sort((a, b) => rank(a) - rank(b));
  addQueued(run, area);
}

function addQueued(run: ExploreRun, a: ExploreArea) {
  run.board.addExplorer({ id: explorerId(a.id), title: a.title, flow: a.flow, tier: a.tier, status: "queued", checks: 0, bugs: 0 });
}

async function sort(run: ExploreRun): Promise<void> {
  const { board } = run;
  board.phase("extracting", `Sorting ${board.state.checks.length} checks`);
  board.change((s) => extractChecks(s, run.filed));
}

async function promote(run: ExploreRun): Promise<void> {
  const { base, board, opts } = run;
  for (const flow of board.state.flows) {
    if (flow.tier === "supporting") continue;
    const checks = board.state.checks.filter((c) => c.flow === flow.name);
    if (checks.length === 0) continue;
    const existing = (opts.tests ?? []).filter((t) => t.flow === flow.name);
    const { candidates, retire } = await promoteFlow(base.thinkLlm(), flow, checks, existing);
    board.change((s) => {
      s.candidates.push(...candidates);
      s.retire.push(...retire);
    });
    board.feed("note", `${flow.name}: ${candidates.length} of ${checks.length} checks earned a test`);
  }
}

async function confirm(run: ExploreRun): Promise<void> {
  const { board, hooks, signal } = run;
  if (board.state.bugs.length === 0) return;
  board.phase("confirming", `Reviewing ${board.state.bugs.length} suspected bugs`);
  await reviewBugs(run);
  await reproduceBugs(run);
  if (signal?.aborted) return;
  for (const c of regressionCandidates(board.state)) {
    board.change((s) => void s.candidates.push(c));
    await hooks.onTest?.(c);
  }
}

/** Nothing ends open: every bug is reviewed, and every Critical flow has a verdict or a named gap. */
async function close(run: ExploreRun): Promise<void> {
  const { board } = run;
  board.phase("closing");
  if (closeGate(board.state).unreviewed.length) await confirm(run);
  board.change((s) => {
    const gate = closeGate(s);
    for (const b of gate.unreviewed) {
      b.status = "not-reproduced";
      b.reasoning ??= "Nobody could settle it in time.";
    }
    for (const f of gate.unsettled) s.gaps.push({ flow: f.name, what: f.name, why: run.blocked ? "A bot check stopped exploring." : "No check reached a verdict before time ran out." });
  });
}
