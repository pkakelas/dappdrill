/** The coordinator: splits the app into areas, shares out the time, and decides what comes next. */
import { z } from "zod";
import { ExploreFlow, TIER_TIME, Tier, checkKey, newId, type ExploreArea, type ExploreState } from "@dappdrill/core";
import type { Llm } from "../types.js";
import type { ExploreOptions } from "./run-context.js";

const MIN_AREA_MS = 3 * 60_000;
const MAX_ROUNDS = 3;
const MAX_PROPOSALS = 4;

const PLAN_SYSTEM = `You plan how to explore a web app in depth. Give every flow a tier:
- critical: it asks the wallet to sign, moves funds, or gates something that does.
- important: it shows balances, positions or market data users rely on.
- supporting: docs, legal, marketing, settings.

Then split the app into areas, one explorer each. Every critical flow gets at least one area of its own; split a big one (a trade form and order management, say). Important flows can share an area. Put all supporting pages in one area. Areas must not overlap: use exclude to say what's left to another area.

Reuse the names of flows the app already has, exactly. Each brief says in two or three sentences what the area holds and what to look out for.`;

const Plan = z.object({
  flows: z.array(ExploreFlow).min(1).max(12),
  areas: z.array(z.object({ title: z.string(), flow: z.string().describe("One of the flows' names"), brief: z.string(), startPath: z.string(), exclude: z.array(z.string()) })).min(1).max(16),
});

export async function planAreas(llm: Llm, url: string, opts: ExploreOptions): Promise<{ flows: ExploreFlow[]; areas: ExploreArea[] }> {
  const { map, hints, tests = [] } = opts;
  const known = [...new Set(tests.map((t) => t.flow))];
  const prompt = [
    `App: ${url}`,
    map && `What it is: ${map.summary}\nPages:\n${map.pages.map((p) => `- ${p.path}: ${p.purpose}`).join("\n")}`,
    known.length && `Flows it has:\n${known.map((f) => `- ${f}: ${tests.filter((t) => t.flow === f).map((t) => t.name).join("; ")}`).join("\n")}`,
    hints && `The developer says:\n${hints}`,
  ].filter(Boolean).join("\n\n");
  const plan = await llm.structured({ system: PLAN_SYSTEM, prompt, schema: Plan, name: "exploration_plan" });
  return settlePlan(plan);
}

/** Every area belongs to a known flow and every critical flow has an area. */
export function settlePlan(plan: z.infer<typeof Plan>): { flows: ExploreFlow[]; areas: ExploreArea[] } {
  const tier = new Map(plan.flows.map((f) => [f.name, f.tier]));
  const areas: ExploreArea[] = plan.areas.filter((a) => tier.has(a.flow)).map((a) => ({ ...a, id: newId("area"), tier: tier.get(a.flow)!, round: 1 }));
  for (const f of plan.flows) {
    if (f.tier !== "critical" || areas.some((a) => a.flow === f.name)) continue;
    areas.push({ id: newId("area"), title: f.name, flow: f.name, tier: f.tier, brief: `Explore ${f.name}. ${f.why}`, startPath: "/", exclude: [], round: 1 });
  }
  return { flows: plan.flows, areas };
}

/** An area's time: its tier's share of the explorers' total, split between that tier's areas. */
export function areaBudgetMs(area: Pick<ExploreArea, "tier">, areas: Pick<ExploreArea, "tier">[], totalMs: number, slots: number): number {
  const tiers = new Set(areas.map((a) => a.tier));
  const share = TIER_TIME[area.tier] / [...tiers].reduce((sum, t) => sum + TIER_TIME[t], 0);
  const same = areas.filter((a) => a.tier === area.tier).length || 1;
  return Math.max(MIN_AREA_MS, (totalMs * slots * share) / same);
}

const Decisions = z.object({
  decisions: z.array(z.object({ index: z.number().int(), accept: z.boolean(), flow: z.string(), tier: Tier, brief: z.string(), note: z.string() })),
});

/** Takes the explorers' proposals to the coordinator. Returns the new areas. */
export async function decideProposals(llm: Llm, state: ExploreState, change: (fn: (s: ExploreState) => void) => void): Promise<ExploreArea[]> {
  const open = state.proposals.flatMap((p, index) => (p.status === "open" ? [{ ...p, index }] : []));
  if (open.length === 0) return [];
  const accepted = state.proposals.filter((p) => p.status === "accepted").length;
  const room = Math.max(0, MAX_PROPOSALS - accepted);
  const out = room
    ? await llm.structured({
        system: `Explorers found work outside their areas. Accept at most ${room}, only what a user would be hurt by missing. Give each its flow (reuse a name when it fits) and tier, and a short brief. note says why in a few words.`,
        prompt: `Flows: ${state.flows.map((f) => `${f.name} (${f.tier})`).join(", ")}\nAreas: ${state.areas.map((a) => a.title).join(", ")}\n\nProposals:\n${open.map((p) => `${p.index}. ${p.title}: ${p.evidence}`).join("\n")}`,
        schema: Decisions,
        name: "scope_decisions",
      })
    : { decisions: [] };
  const areas: ExploreArea[] = [];
  change((s) => {
    for (const p of open) {
      const d = out.decisions.find((x) => x.index === p.index);
      const take = !!d?.accept && areas.length < room;
      s.proposals[p.index]!.status = take ? "accepted" : "declined";
      s.proposals[p.index]!.note = d?.note ?? "No room left in the plan.";
      if (!take || !d) continue;
      if (!s.flows.some((f) => f.name === d.flow)) s.flows.push({ name: d.flow, tier: d.tier, why: p.evidence });
      areas.push({ id: newId("area"), title: p.title, flow: d.flow, tier: d.tier, brief: d.brief, startPath: p.startPath, exclude: [], round: 1 });
    }
  });
  return areas;
}

/**
 * Spare time goes back into Critical flows: first any with no checks, then the fewest checks,
 * until a round adds nothing new.
 */
export function deeperAreas(state: ExploreState): ExploreArea[] {
  const areas: ExploreArea[] = [];
  const critical = state.flows.filter((f) => f.tier === "critical").map((f) => ({ flow: f, checks: state.checks.filter((c) => c.flow === f.name) }));
  for (const { flow, checks } of critical.sort((a, b) => a.checks.length - b.checks.length)) {
    const mine = state.areas.filter((a) => a.flow === flow.name);
    const round = Math.max(0, ...mine.map((a) => a.round));
    if (round >= MAX_ROUNDS) continue;
    if (round > 1 && !addedInRound(state, flow.name, round)) continue;
    const seen = [...new Set(checks.map((c) => c.name))].slice(-30);
    const tried = new Set(checks.map((c) => c.variation));
    const missing = ["happy", "input", "path", "state", "agreement", "round-trip"].filter((v) => !tried.has(v as never));
    areas.push({
      id: newId("area"),
      title: `${flow.name}, round ${round + 1}`,
      flow: flow.name,
      tier: flow.tier,
      brief: [
        `Go deeper on ${flow.name}: find what earlier explorers didn't.`,
        missing.length ? `Nobody tried these variations yet: ${missing.join(", ")}.` : "Every variation was tried once; look for harder cases of each.",
        seen.length ? `Already checked, don't repeat:\n${seen.map((n) => `- ${n}`).join("\n")}` : "",
      ].filter(Boolean).join("\n"),
      startPath: mine[0]?.startPath ?? "/",
      exclude: [],
      round: round + 1,
    });
  }
  return areas;
}

/** Whether the flow's latest round found a check earlier rounds hadn't. */
function addedInRound(state: ExploreState, flow: string, round: number): boolean {
  const late = new Set(state.explorers.filter((e) => e.flow === flow && state.areas.some((a) => a.id === areaOf(e.id) && a.round === round)).map((e) => e.id));
  const before = new Set(state.checks.filter((c) => c.flow === flow && !late.has(c.explorerId)).map(checkKey));
  return state.checks.some((c) => late.has(c.explorerId) && !before.has(checkKey(c)));
}

/** Explorers are named after their area. */
export const explorerId = (areaId: string) => `exp_${areaId}`;
const areaOf = (id: string) => id.slice("exp_".length);
