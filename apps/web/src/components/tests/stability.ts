import type { Stability } from "@dappdrill/db";

/** "about $0.08 a run", or "under $0.01 a run" when a run cost almost nothing. */
function perRun(usd: number): string {
  return usd < 0.005 ? "under $0.01 a run" : `about $${usd.toFixed(2)} a run`;
}

/**
 * One quiet line under a test: whether its saved steps still carry it, and what a run costs.
 * "Replayed from saved steps on all of the last 6 runs · about $0.08 a run"
 * "The agent stepped in on 3 of the last 6 runs · about $0.41 a run"
 * Null with no finished runs.
 */
export function stabilityText(s: Stability | undefined): string | null {
  if (!s || s.runs === 0) return null;
  const all = s.runs === 1 ? "the last run" : `all of the last ${s.runs} runs`;
  const some = s.agentRuns === s.runs ? all : `${s.agentRuns} of the last ${s.runs} runs`;
  const how = s.agentRuns === 0 ? `Replayed from saved steps on ${all}` : `The agent stepped in on ${some}`;
  const cost = s.avgCostUsd !== null && s.avgCostUsd > 0 ? ` · ${perRun(s.avgCostUsd)}` : "";
  return how + cost;
}
