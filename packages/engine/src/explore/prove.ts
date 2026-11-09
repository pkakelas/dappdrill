/**
 * A suggested test that worked for an explorer becomes a saved test by passing on a clean fork,
 * with none of the explorer's memory. What the explorer did is replayed first, which is cheap;
 * when that doesn't pass, the test runs from its plain steps alone. Its goal never changes to make
 * it pass: a failure is a draft with the reason, or a bug when the chain says so.
 */
import { CONDITIONS, newId, nowIso, type EdgeCaseId, type ExploreState, type ExploreSuggestion, type TestSpec, type Tier } from "@dappdrill/core";
import type { Env } from "../pipeline/env.js";
import { pin } from "../pipeline/pin.js";
import { runTestItems, type TestOutcome } from "../pipeline/tests.js";
import { evidenceOf, fileBug } from "./bugs.js";
import { lineUp } from "./recorded.js";
import type { ExploreRun } from "./run-context.js";

/** Proves it as soon as a browser is free, while the explorers carry on. */
export function queueProof(run: ExploreRun, suggestionId: string): void {
  run.work(() => run.withEnv("prove", (env) => prove(run, env, suggestionId)));
}

async function prove(run: ExploreRun, env: Env, id: string): Promise<void> {
  const { board, signal, map } = run;
  const { artifactsDir, baselines } = run.opts;
  const s = board.state.suggested.find((x) => x.id === id);
  if (!s || s.status !== "worked" || signal?.aborted) return;
  const worker = `prove_${id}`;
  const update = (fn: (x: ExploreSuggestion) => void) => board.change((state) => void fn(state.suggested.find((x) => x.id === id)!));
  const end = (status: "done" | "stopped") => board.explorer(worker, { status, doing: undefined, finishedAt: nowIso() });
  update((x) => (x.status = "proving"));
  board.addExplorer({ id: worker, title: `Proving: ${s.draft.name}`, feature: s.feature, tier: s.tier, status: "running", doing: run.isolated ? "Running it on a clean fork" : "Running it again in a fresh browser", startedAt: nowIso(), activeAt: nowIso() });

  // An attempt on a fork may run the setup again, so the fork goes back to clean first: a second
  // mint or deposit on top of the first would fail a test that was fine. A live chain can't go
  // back, and there the attempt starts from the setup the pass already ran.
  const attempt = async (spec: TestSpec) => {
    const restore = await pin(env);
    try {
      const [o] = await runTestItems(env, [{ spec }], { artifactsDir, map, baselines, signal, setup: run.setup, ready: run.setup && run.ready }, {
        onFrame: async (_id, frame) => board.explorer(worker, { frame, activeAt: nowIso() }),
        onProgress: async (_id, result) => {
          const at = result.steps.findIndex((r) => r.status === "running");
          if (at >= 0) board.explorer(worker, { doing: s.draft.steps[at], activeAt: nowIso() });
        },
      });
      return o;
    } finally {
      await restore();
    }
  };
  const plain = plainSpec(s);
  const recorded = run.recorded.get(id);
  const replayed = recorded && (await lineUp(env.fastLlm(), s.draft, recorded).catch(() => undefined));
  let o = replayed ? await attempt({ ...plain, steps: replayed }) : undefined;
  // What an explorer did can include a wrong turn, so a replay that fails says little about the test.
  if (!o || (o.status !== "pass" && o.status !== "stopped")) o = await attempt(plain);
  if (!o || o.status === "stopped") {
    update((x) => (x.status = "worked"));
    return end("stopped");
  }
  if (o.status === "pass" && o.steps) {
    update((x) => {
      x.status = "proved";
      x.steps = o.steps;
      x.conditions = conditionsFor(x.tier, o, env);
      x.provedAt = nowIso();
    });
    board.feed("test", `Saved as a test: ${s.draft.name}`);
    await run.hooks.onTest?.(current(board.state, id));
    return end("done");
  }

  const why = o.result.failure ?? o.result.verdict?.reason ?? (run.isolated ? "It didn't pass on a clean fork." : "It didn't pass in a fresh browser.");
  const hard = hardEvidence(o);
  if (hard) {
    const bugId = fileBug(run, {
      id: newId("bug"),
      explorerId: "",
      feature: s.feature,
      name: s.draft.name,
      summary: hard,
      steps: s.draft.steps,
      expected: s.draft.expected,
      actual: why,
      severity: s.tier === "critical" ? "high" : "medium",
      status: "suspected",
      source: "prove",
      seen: 1,
      evidence: evidenceOf(o),
      at: nowIso(),
    });
    update((x) => {
      x.status = "bug";
      x.note = why;
      x.bugId = bugId;
    });
    return end("done");
  }
  update((x) => {
    x.status = "draft";
    x.note = why;
  });
  board.feed("fail", `${s.draft.name} is a draft: ${why}`);
  await run.hooks.onTest?.(current(board.state, id));
  end("done");
}

function plainSpec(s: ExploreSuggestion): TestSpec {
  const { name, goal, expected, startPath, steps } = s.draft;
  return { id: s.id, name, goal, expected, startPath, steps: steps.map((text) => ({ text })) };
}

const current = (state: ExploreState, id: string) => structuredClone(state.suggested.find((x) => x.id === id)!);

/**
 * What makes a failed proof the app's fault rather than a wrong guess: the chain refused a
 * transaction the app asked for. A dangerous signature doesn't count: explorers file those when
 * they see them, and a test that signs one can fail for any other reason.
 */
export function hardEvidence(o: Pick<TestOutcome, "result">): string | undefined {
  const reverted = o.result.walletRequests.find((r) => r.kind === "sign" && r.outcome === "errored" && /revert/i.test(r.error ?? ""));
  return reverted ? `The transaction reverted: ${(reverted.error ?? "").slice(0, 200)}` : undefined;
}

/**
 * Conditions change a result only where the test itself sends a transaction, so only those tests
 * of Critical features get them. The setup's requests come first in a result, so the test's own
 * are the last ones, one for each wallet step.
 */
export function conditionsFor(tier: Tier, o: Pick<TestOutcome, "result" | "steps">, env: Pick<Env, "chains">): EdgeCaseId[] {
  const answers = (o.steps ?? []).flatMap((s) => s.actions ?? []).filter((a) => a.kind === "wallet").length;
  if (tier !== "critical" || answers === 0) return [];
  const own = o.result.walletRequests.filter((r) => r.kind === "sign").slice(-answers);
  if (!own.some((r) => r.method === "eth_sendTransaction" && r.outcome === "approved")) return [];
  const live = env.chains.configs().some((x) => x.mode !== "fork");
  return CONDITIONS.filter((x) => x.default && !(live && x.needsFork)).map((x) => x.id);
}
