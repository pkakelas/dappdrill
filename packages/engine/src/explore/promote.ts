/**
 * From checks to candidate tests. Most checks stay checks: a test has to matter, be able to fail
 * in its own way, prove an outcome, and later prove itself stable.
 */
import { z } from "zod";
import { TIER_TESTS, TestDraft, checkKey, newId, nowIso, type ExploreCandidate, type ExploreCheck, type ExploreFlow, type ExploreState } from "@dappdrill/core";
import type { Llm } from "../types.js";
import type { KnownTest } from "./run-context.js";

/**
 * Same check twice is one check; a failure wins so it still gets looked at. Failed checks with
 * no bug report become suspected bugs. A flow that signed is Critical, whatever the plan said.
 */
export function extractChecks(state: ExploreState, filed: Set<string>): void {
  const kept = new Map<string, ExploreCheck>();
  for (const c of state.checks) {
    const key = checkKey(c);
    const had = kept.get(key);
    if (!had || (had.status !== "fail" && c.status === "fail")) kept.set(key, c);
  }
  state.checks = [...kept.values()];

  for (const c of state.checks) {
    if (c.status !== "fail" || filed.has(c.id)) continue;
    state.bugs.push({
      id: newId("bug"),
      explorerId: c.explorerId,
      flow: c.flow,
      name: c.name,
      summary: c.evidence,
      steps: c.path,
      expected: c.name,
      actual: c.evidence,
      severity: c.signs ? "high" : "medium",
      status: "suspected",
      source: "check",
      evidence: { screenshot: c.screenshot, console: [], network: [], chain: [] },
      at: nowIso(),
    });
  }

  for (const f of state.flows) {
    if (f.tier !== "critical" && state.checks.some((c) => c.flow === f.name && c.signs)) {
      f.tier = "critical";
      f.why = "Its paths asked the wallet to sign.";
    }
  }
}

const PROMOTE_SYSTEM = `You decide which checks from exploring a flow become saved tests. Checks are cheap and stay checks unless they earn a test. A test earns its place when:
- it can fail in its own way: a bug could break it while the other tests still pass;
- it proves an outcome: funds moved, state changed, an error stopped something bad. "The page opened" doesn't count.
Merge similar checks into one test (the same action on two markets is one test), listing every checkId it covers. Only use checks that passed.

Write tests plainly: name is what the user does; goal and expected are one sentence; steps are 3 to 8 short imperative lines at the level a user thinks ("Enter 5 as the amount", "Approve in the wallet"), no selectors. A test's steps come from its checks' paths.

Also list existing tests that exploring shows are out of date (the feature is gone or works differently) under retire. Leave them out if they're fine.`;

const Picks = z.object({
  candidates: z.array(
    z.object({
      checkIds: z.array(z.string()),
      test: TestDraft,
      why: z.string().describe("One short sentence: why this earned a test"),
      canFailOnItsOwn: z.boolean(),
      provesOutcome: z.boolean(),
    }),
  ),
  retire: z.array(z.object({ testId: z.string(), reason: z.string() })),
});
export type Picks = z.infer<typeof Picks>;

export async function promoteFlow(llm: Llm, flow: ExploreFlow, checks: ExploreCheck[], existing: KnownTest[]): Promise<{ candidates: ExploreCandidate[]; retire: ExploreState["retire"] }> {
  const room = TIER_TESTS[flow.tier] - existing.length;
  const prompt = [
    `Flow: ${flow.name} (${flow.tier}), room for at most ${Math.max(0, room)} new tests.`,
    existing.length ? `Existing tests:\n${existing.map((t) => `- ${t.id}: ${t.name}: ${t.goal}`).join("\n")}` : "No tests yet.",
    `Checks:\n${checks.map((c) => `- ${c.id} [${c.variation}, ${c.status}] ${c.name}\n  from ${c.startPath}: ${c.path.join(" → ")}\n  found: ${c.evidence}`).join("\n")}`,
  ].join("\n\n");
  const picks = await llm.structured({ system: PROMOTE_SYSTEM, prompt, schema: Picks, name: "promoted_tests" });
  return {
    candidates: enforceRule(flow, picks, checks, existing),
    retire: picks.retire.flatMap((r) => {
      const t = existing.find((x) => x.id === r.testId);
      return t ? [{ testId: t.id, name: t.name, reason: r.reason }] : [];
    }),
  };
}

/** The rule in code, so a generous model can't fill the suite. */
export function enforceRule(flow: ExploreFlow, picks: Picks, checks: ExploreCheck[], existing: KnownTest[]): ExploreCandidate[] {
  if (flow.tier === "supporting") return [];
  const passed = new Set(checks.filter((c) => c.status === "pass").map((c) => c.id));
  const names = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  const room = Math.max(0, TIER_TESTS[flow.tier] - existing.length);
  const out: ExploreCandidate[] = [];
  for (const p of picks.candidates) {
    if (out.length >= room) break;
    if (!p.canFailOnItsOwn || !p.provesOutcome) continue;
    const ids = p.checkIds.filter((id) => passed.has(id));
    const name = p.test.name.trim().toLowerCase();
    if (ids.length === 0 || names.has(name)) continue;
    names.add(name);
    out.push({ id: newId("cand"), flow: flow.name, tier: flow.tier, draft: p.test, checkIds: ids, why: p.why, status: "waiting", conditions: [] });
  }
  return out;
}
