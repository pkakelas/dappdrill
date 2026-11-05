/**
 * A candidate becomes a saved test by passing on a fresh fork from its plain steps alone, with
 * none of the explorer's memory, and then again from the actions that run recorded. Its goal never
 * changes to make it pass: a failure stays a draft with the reason, or a suspected bug.
 */
import { CONDITIONS, newId, nowIso, type EdgeCaseId, type ExploreCandidate, type ExploreState, type TestSpec } from "@dappdrill/core";
import type { Env } from "../pipeline/env.js";
import { runTestItems, type TestItem, type TestOutcome } from "../pipeline/tests.js";
import { evidenceOf } from "./bugs.js";
import type { ExploreRun } from "./run-context.js";

export async function proveCandidates(run: ExploreRun): Promise<void> {
  const { board } = run;
  const waiting = board.state.candidates.filter((c) => c.status === "waiting");
  const shares = Array.from({ length: Math.min(run.slots, waiting.length) }, (_, i) => waiting.filter((_c, n) => n % run.slots === i));
  await Promise.all(shares.map((share, i) => run.withEnv((env) => proveShare(run, env, share, `prove_${i + 1}`))));
}

async function proveShare(run: ExploreRun, env: Env, share: ExploreCandidate[], worker: string): Promise<void> {
  const { board, signal } = run;
  const { artifactsDir, map, baselines, setup } = run.opts;
  board.addExplorer({ id: worker, title: "Proving tests", flow: "", tier: "critical", status: "running", checks: 0, bugs: 0, startedAt: nowIso(), activeAt: nowIso() });
  const update = (id: string, fn: (c: ExploreCandidate) => void) => board.change((s) => {
    const c = s.candidates.find((x) => x.id === id);
    if (c) fn(c);
  });
  const hooks = (pass: string) => ({
    onStart: async (id: string) => {
      const c = share.find((x) => x.id === id)!;
      update(id, (x) => (x.status = "proving"));
      board.explorer(worker, { doing: `${pass}: ${c.draft.name}`, flow: c.flow, activeAt: nowIso() });
    },
    onFrame: async (_id: string, frame: string) => board.explorer(worker, { frame, activeAt: nowIso() }),
  });
  const opts = { artifactsDir, map, baselines, signal, setup: setup?.steps.length ? setup : undefined };

  // First pass: plain steps, the way a new reader of the test would do them.
  const fresh = await runTestItems(env, share.map(plainItem), opts, hooks("First run"));
  const passed: TestItem[] = [];
  for (const o of fresh) {
    const c = share.find((x) => x.id === o.testId)!;
    if (o.status === "stopped") continue;
    if (o.status === "pass" && o.steps) {
      update(c.id, (x) => (x.steps = o.steps));
      passed.push({ spec: { ...plainItem(c).spec, steps: o.steps, proof: o.proof } });
      continue;
    }
    const why = o.result.failure ?? "It didn't pass on a fresh fork.";
    const bugId = o.status === "fail" && o.result.verdict?.ok === false ? fileProveBug(run, c, why, o) : undefined;
    update(c.id, (x) => {
      x.status = "draft";
      x.note = why;
      x.bugId = bugId;
    });
    board.feed("fail", `${c.draft.name} stays a draft: ${why}`);
    await run.hooks.onTest?.(current(board.state, c.id));
  }

  // Second pass: the recorded actions. A test that can't repeat itself isn't a test.
  const again = await runTestItems(env, passed, opts, hooks("Second run"));
  for (const o of again) {
    const c = share.find((x) => x.id === o.testId)!;
    if (o.status === "stopped") continue;
    if (o.status !== "pass") {
      update(c.id, (x) => {
        x.status = "demoted";
        x.note = `Passed once, then failed: ${o.result.failure ?? "no reason given"}`;
      });
      board.feed("note", `${c.draft.name} stays a check: it passed once, then failed`);
      continue;
    }
    update(c.id, (x) => {
      x.status = "proved";
      x.steps = o.steps ?? x.steps;
      x.proof = o.proof;
      x.conditions = conditionsFor(x, board.state, env);
    });
    board.feed("test", `Saved ${c.draft.name}`);
    await run.hooks.onTest?.(current(board.state, c.id));
  }
  board.explorer(worker, { status: signal?.aborted ? "stopped" : "done", doing: undefined, finishedAt: nowIso() });
}

function plainItem(c: ExploreCandidate): { spec: TestSpec } {
  const { name, goal, expected, startPath, steps } = c.draft;
  return { spec: { id: c.id, name, goal, expected, startPath, steps: steps.map((text) => ({ text })) } };
}

const current = (state: ExploreState, id: string) => structuredClone(state.candidates.find((c) => c.id === id)!);

/** All the steps ran and the result still wasn't there: that may be the app, so it gets reviewed. */
function fileProveBug(run: ExploreRun, c: ExploreCandidate, why: string, o: TestOutcome): string {
  const id = newId("bug");
  run.board.change((s) => {
    s.bugs.push({
      id,
      explorerId: "",
      flow: c.flow,
      name: c.draft.name,
      summary: why,
      steps: c.draft.steps,
      expected: c.draft.expected,
      actual: why,
      severity: c.tier === "critical" ? "high" : "medium",
      status: "suspected",
      source: "check",
      evidence: evidenceOf(o),
      at: nowIso(),
    });
  });
  run.board.feed("bug", c.draft.name);
  return id;
}

/** Conditions change a result only where something is signed, so only the main signing paths of Critical flows get them. */
export function conditionsFor(c: ExploreCandidate, state: ExploreState, env: Pick<Env, "chains">): EdgeCaseId[] {
  if (c.tier !== "critical") return [];
  const from = state.checks.filter((k) => c.checkIds.includes(k.id));
  if (!from.some((k) => k.signs && (k.variation === "happy" || k.variation === "round-trip"))) return [];
  const live = env.chains.configs().some((x) => x.mode !== "fork");
  return CONDITIONS.filter((x) => x.default && !(live && x.needsFork)).map((x) => x.id);
}
