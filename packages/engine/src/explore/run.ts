/**
 * A pass from start to finish: look around, check the setup, give each feature an explorer, and
 * prove tests and settle bugs while they work. It ends when nothing new turns up or the time is
 * up, and never with a bug unreviewed or a Critical feature unaccounted for.
 */
import { AppSetup, blockedLine, closeGate, newId, nowIso, stalledLine, TIER_TIME, type Blocked, type ChainConfig, type DrillEventSink, type DrillTarget, type ExploreFeature, type ExploreState, type TestSpec, type TestStep } from "@dappdrill/core";
import { diagnoseStall } from "../browser/traffic.js";
import { openEnv, withoutFallback } from "../pipeline/env.js";
import { pin } from "../pipeline/pin.js";
import { setupRunner } from "../pipeline/setup.js";
import { landingBotCheck, openSession, plain } from "../pipeline/steps.js";
import { runExplorer, type ExplorerJob } from "./explorer.js";
import { withToken, type WalletToken } from "./funding.js";
import { lookAround, type Found } from "./look.js";
import { ExploreRun, type ExploreHooks, type ExploreOptions } from "./run-context.js";

export type { ExploreHooks, ExploreOptions, KnownBug, KnownTest } from "./run-context.js";

export interface ExploreOutput {
  state: ExploreState;
  blocked?: Blocked;
  chains: ChainConfig[];
  costUsd: number;
  /** What the look found, so a later pass can start from it. */
  found?: Found;
  /** What the test wallet starts with on forks, including what the look gave it. Runs of this pass's tests need the same. */
  tokens: WalletToken[];
}

/** Below this nothing useful fits in a new explorer. */
const MIN_EXPLORER_MS = 2 * 60_000;
/** A feature gets at most this many explorers, one after another. */
export const MAX_ROUNDS = 3;

const CONNECT: AppSetup = { startPath: "/", steps: [{ text: "Connect the wallet" }], when: "once" };

export async function runExploration(target: DrillTarget, opts: ExploreOptions, hooks: ExploreHooks, sink: DrillEventSink, signal?: AbortSignal): Promise<ExploreOutput> {
  const base = await openEnv(target, sink, { headless: opts.headless });
  const run = new ExploreRun(base, opts, hooks, sink, signal);
  const { board } = run;
  try {
    if ((await look(run)) && opts.until !== "look" && (await checkSetup(run)) && opts.until !== "setup") {
      await explore(run);
      if (!signal?.aborted) board.phase("finishing");
    }
    // Proofs and bug reviews started along the way; a stopped pass only waits for them to let go.
    await run.settled();
    await close(run);
    board.change((s) => (s.costs = run.costs()));
    board.phase("done");
    await board.flush();
    return { state: board.state, blocked: run.blocked, chains: withoutFallback(base.chains.configs()), costUsd: run.costUsd(), found: run.found, tokens: base.target.tokens };
  } finally {
    await run.baseRunner?.close();
    await base.close();
  }
}

/** Maps the app: what it is, what a new user does first, its features and the tests worth trying. */
async function look(run: ExploreRun): Promise<boolean> {
  const { base, board, opts, signal } = run;
  board.phase("looking", "Looking around the app");
  // An earlier look's result stands in for a new one.
  if (opts.found) {
    await take(run, opts.found);
    return true;
  }
  board.addExplorer({ id: "look", title: "Looking around", feature: "", tier: "critical", status: "running", doing: "Opening the app", startedAt: nowIso(), activeAt: nowIso() });
  const end = (status: "done" | "failed" | "stopped", error?: string) => board.explorer("look", { status, error, doing: undefined, finishedAt: nowIso() });
  const stop = (why: string) => {
    board.change((s) => (s.stopped = why));
    end("failed", why);
    return false;
  };
  const restore = await pin(base);
  const session = await openSession(base, opts.artifactsDir, async (frame) => board.explorer("look", { frame, url: session?.page.url(), activeAt: nowIso() }), { video: false, trace: false });
  try {
    await session.page.goto(base.target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // A challenge on the first page stops before anything is spent on the model.
    const bot = await landingBotCheck(session);
    const { found, blocked } = bot
      ? { found: undefined, blocked: bot }
      : await lookAround(session, base.thinkLlm(), {
          hints: opts.hints,
          known: opts.tests,
          inbox: base.inbox,
          signal,
          onNote: (text) => {
            board.feed("note", text, "look");
            board.explorer("look", { doing: text, activeAt: nowIso() });
          },
          // The target is what every later fork and browser of this pass is opened from.
          onFunded: (token) => void (base.target.tokens = withToken(base.target.tokens, token)),
        });
    if (signal?.aborted) {
      end("stopped");
      return false;
    }
    if (!found) {
      if (blocked) {
        run.blocked = blocked;
        return stop(blockedLine(blocked));
      }
      // Nothing to test usually means the app's data never loaded; say what it was waiting on.
      const missing = base.chains.missing();
      const waiting = diagnoseStall(session.traffic, session.rpc, base.chains.configs().map((c) => c.id));
      const stalled = missing.length ? { backends: [], rpc: [], ...waiting, chains: missing } : waiting;
      return stop(stalled ? stalledLine(stalled) : "Nothing to test turned up while looking around the app.");
    }
    await take(run, found);
    end("done");
    return true;
  } catch (e) {
    if (signal?.aborted) {
      end("stopped");
      return false;
    }
    return stop(`Looking around the app didn't finish. ${plain(e)}`);
  } finally {
    await session.close().catch(() => {});
    await restore();
  }
}

/** Puts what a look found on the board: the map, the setup, the features and their suggested tests. */
async function take(run: ExploreRun, found: Found): Promise<void> {
  const { board, opts, hooks } = run;
  run.found = found;
  run.map = { summary: found.summary, pages: found.pages };
  const saved = opts.setup?.steps.length ? opts.setup : undefined;
  const proposed = !saved && found.setup ? AppSetup.parse({ ...found.setup, steps: found.setup.steps.map((text) => ({ text })) }) : undefined;
  run.setup = saved ?? proposed;
  await hooks.onMap?.(run.map, proposed);

  const known = (name: string) => opts.tests?.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  board.change((s) => {
    s.features = found.features.map(({ tests: _tests, ...f }) => f);
    for (const f of found.features) {
      for (const draft of f.tests) {
        if (known(draft.name) || s.suggested.some((x) => x.draft.name === draft.name)) continue;
        s.suggested.push({ id: newId("sug"), feature: f.name, tier: f.tier, draft, status: "suggested", conditions: [] });
      }
    }
  });
  const tests = board.state.suggested.length;
  board.feed("note", `Found ${found.features.length} ${found.features.length === 1 ? "feature" : "features"} and ${tests} ${tests === 1 ? "test" : "tests"} to try`);
}

/** The setup has to work from a clean start before anything is spent on exploring. */
async function checkSetup(run: ExploreRun): Promise<boolean> {
  const { base, board, opts, hooks, signal } = run;
  run.stage("setup");
  const real = run.setup;
  board.phase("setup", real ? "Running the app's setup" : "Checking the wallet connects");
  board.addExplorer({ id: "setup", title: real ? "Setup" : "Connecting the wallet", feature: "", tier: "critical", status: "running", doing: real?.steps[0]?.text ?? "Connecting the wallet", startedAt: nowIso(), activeAt: nowIso() });
  let entry = real ?? CONNECT;
  const runner = setupRunner(base, entry, { artifactsDir: opts.artifactsDir, map: run.map, baselines: opts.baselines }, {
    onFrame: async (_id, frame) => board.explorer("setup", { frame, activeAt: nowIso() }),
    onSetupSteps: async (steps: TestStep[]) => {
      entry = { ...entry, steps };
      if (real) {
        run.setup = entry;
        await hooks.onSetupSteps?.(steps);
      }
    },
  });
  run.baseRunner = runner;
  const spec: TestSpec = { id: "setup", name: "Setup", goal: "", expected: "", startPath: entry.startPath, steps: [] };
  const ready = await runner.prepare(spec, signal).catch((e) => ({ outcome: { result: { failure: plain(e) } } }));
  run.entry = entry;
  if (signal?.aborted) {
    board.explorer("setup", { status: "stopped", doing: undefined, finishedAt: nowIso() });
    return false;
  }
  if ("outcome" in ready) {
    const why = ready.outcome.result.failure ?? "Setup didn't finish.";
    board.explorer("setup", { status: "failed", error: why, doing: undefined, finishedAt: nowIso() });
    board.change((s) => (s.stopped = real ? `The app's setup didn't work, so nothing was explored. ${why}` : `The wallet didn't connect, so nothing was explored. ${why}`));
    return false;
  }
  run.ready = runner.portable();
  board.explorer("setup", { status: "done", doing: undefined, finishedAt: nowIso() });
  board.feed("pass", real ? "The app's setup works" : "The wallet connects");
  return true;
}

const RANK = { critical: 0, important: 1, supporting: 2 };

/** One explorer per feature that matters, and one for all the supporting pages. */
export function firstJobs(all: ExploreFeature[], only?: string[]): Omit<ExplorerJob, "id">[] {
  const picked = only?.map((n) => n.trim().toLowerCase());
  const features = picked ? all.filter((f) => picked.includes(f.name.toLowerCase())) : all;
  const main = features.filter((f) => f.tier !== "supporting").sort((a, b) => RANK[a.tier] - RANK[b.tier]);
  const rest = features.filter((f) => f.tier === "supporting");
  const other: ExploreFeature[] =
    rest.length > 1
      ? [{ name: "Other pages", tier: "supporting", why: "Docs, legal and the like.", startPath: rest[0]!.startPath, brief: `These pages: ${rest.map((f) => `${f.name} (${f.startPath}): ${f.brief}`).join(" ")}` }]
      : rest;
  return [...main, ...other].map((feature) => ({ feature, round: 1 }));
}

/**
 * Whether a feature earns another explorer. It does while suggested tests are still untried, and
 * a Critical one also while its last explorer kept finding things.
 */
export function nextRound(state: Pick<ExploreState, "suggested" | "bugs" | "checks">, job: Pick<ExplorerJob, "feature" | "round">, found: number): Omit<ExplorerJob, "id"> | undefined {
  const { feature, round } = job;
  if (feature.tier === "supporting" || round >= MAX_ROUNDS) return undefined;
  const untried = state.suggested.some((x) => x.feature === feature.name && x.status === "suggested" && !x.note);
  if (!untried && !(feature.tier === "critical" && found > 0)) return undefined;
  const checks = state.checks.filter((c) => c.feature === feature.name).map((c) => c.name);
  const bugs = state.bugs.filter((b) => b.feature === feature.name).map((b) => b.name);
  const more = [
    `This is go ${round + 1} at this feature. Don't repeat what was done; try what wasn't.`,
    checks.length && `Already checked:\n${[...new Set(checks)].slice(-40).map((c) => `- ${c}`).join("\n")}`,
    bugs.length && `Bugs already filed here:\n${bugs.map((b) => `- ${b}`).join("\n")}`,
  ];
  return { feature, round: round + 1, more: more.filter(Boolean).join("\n\n") };
}

/** What a feature has turned up so far: tests handed over and bugs filed. */
const finds = (s: ExploreState, feature: string) => s.suggested.filter((x) => x.feature === feature && x.explorerId).length + s.bugs.filter((b) => b.feature === feature).length;

async function explore(run: ExploreRun): Promise<void> {
  const { board, opts, signal } = run;
  const totalMs = opts.budgetMinutes * 60_000;
  const deadline = Date.now() + totalMs;
  const left = () => deadline - Date.now();
  board.phase("exploring");
  board.change((s) => (s.deadline = new Date(deadline).toISOString()));
  // With chains of their own the explorers leave the shared ones to bug reviews.
  if (run.isolated) run.stage("confirm");

  // One browser stays free for proving tests and reproducing bugs.
  const atOnce = Math.max(1, run.slots - 1);
  let n = 0;
  const queue: ExplorerJob[] = [];
  const add = (job: Omit<ExplorerJob, "id">) => {
    const id = `exp_${++n}`;
    queue.push({ ...job, id });
    queue.sort((a, b) => RANK[a.feature.tier] - RANK[b.feature.tier] || a.round - b.round);
    board.addExplorer({ id, title: job.feature.name, feature: job.feature.name, tier: job.feature.tier, round: job.round, status: "queued" });
  };
  for (const job of firstJobs(board.state.features, opts.only)) add(job);

  const running = new Map<string, Promise<void>>();
  // Explorers that never got going (a fork or a browser that wouldn't start), by feature.
  const broke = new Set<string>();
  const start = (job: ExplorerJob) => {
    const before = finds(board.state, job.feature.name);
    const budget = Math.min(left(), TIER_TIME[job.feature.tier] * totalMs);
    let error: string | undefined;
    run.exploring++;
    const done = run
      .withEnv("explore", (env) => runExplorer(run, env, job, budget))
      .catch((e) => board.explorer(job.id, { status: "failed", error: (error = plain(e)), doing: undefined, finishedAt: nowIso() }))
      .finally(() => {
        run.exploring--;
        running.delete(job.id);
        run.pump();
        const go = !signal?.aborted && !run.blocked && left() >= MIN_EXPLORER_MS;
        if (error) {
          // Ours, not the feature's: the same go once more, then a gap that says why.
          const again = go && !broke.has(job.feature.name);
          broke.add(job.feature.name);
          board.feed("error", `${job.feature.name}: the explorer stopped (${error})${again ? ", starting it again" : ""}`);
          if (again) add({ feature: job.feature, round: job.round, more: job.more });
          else board.change((s) => void s.gaps.push({ feature: job.feature.name, what: job.feature.name, why: `Its explorer couldn't run: ${error}` }));
          return;
        }
        const next = nextRound(board.state, job, finds(board.state, job.feature.name) - before);
        if (next && go) {
          add(next);
          board.feed("note", `${job.feature.name}: there is more to find, going again`);
        }
      });
    running.set(job.id, done);
  };

  for (;;) {
    const stop = signal?.aborted || run.blocked || left() < MIN_EXPLORER_MS;
    if (!stop) while (running.size < atOnce && queue.length) start(queue.shift()!);
    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  for (const job of queue) {
    board.explorer(job.id, { status: "stopped", finishedAt: nowIso() });
    if (job.feature.tier === "critical" && job.round === 1) board.change((s) => void s.gaps.push({ feature: job.feature.name, what: job.feature.name, why: "Ran out of time before it started." }));
  }
}

/** Nothing ends open: every bug has a verdict, and every Critical feature a result or a named gap. */
async function close(run: ExploreRun): Promise<void> {
  const { board, signal } = run;
  board.change((s) => {
    // A stopped pass keeps what it was in the middle of on offer.
    for (const x of s.suggested) {
      if (x.status === "trying") x.status = "suggested";
      if (x.status === "proving") x.status = "worked";
    }
    for (const e of s.explorers) if (e.status === "running" || e.status === "queued") Object.assign(e, { status: "stopped", doing: undefined, finishedAt: nowIso() });
    if (signal?.aborted || !s.features.length) return;
    const gate = closeGate(s);
    for (const b of gate.unreviewed) {
      b.status = "not-reproduced";
      b.reasoning ??= "Nobody could settle it in time.";
      for (const x of s.suggested) if (x.bugId === b.id && x.status === "bug") Object.assign(x, { status: "suggested", bugId: undefined });
    }
    // A pass that stopped, or was only asked for part of the app, leaves the rest unjudged.
    if (s.stopped || run.opts.until) return;
    const asked = (name: string) => !run.opts.only || run.opts.only.some((n) => n.trim().toLowerCase() === name.toLowerCase());
    for (const f of gate.unsettled) if (asked(f.name) && !s.gaps.some((g) => g.feature === f.name)) s.gaps.push({ feature: f.name, what: f.name, why: run.blocked ? "A bot check stopped exploring." : "No check reached a result before time ran out." });
  });
}
