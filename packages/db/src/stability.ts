/**
 * How a test's recent runs went: whether its saved steps still carry it, or the agent has to step in.
 */
import { and, count, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { testRuns } from "./schema/app.js";
import { SAYS_SOMETHING } from "./tests.js";

/** How many recent runs are looked at. */
export const STABILITY_RUNS = 10;

export interface Stability {
  /** Finished runs counted, at most STABILITY_RUNS. */
  runs: number;
  /** Runs in which the agent did at least one step. */
  agentRuns: number;
  /** Average spend per run, when the runs recorded one. */
  avgCostUsd: number | null;
}

/**
 * Over each test's last STABILITY_RUNS finished runs (passed or failed, not ones we broke): how many
 * there were, how many the agent stepped into, and what a run cost on average. Tests with no finished
 * run are left out.
 */
export async function testStability(db: Db, testIds: string[]): Promise<Map<string, Stability>> {
  if (testIds.length === 0) return new Map();
  const recent = db
    .select({
      testId: testRuns.testId,
      agent: sql<boolean>`exists (select 1 from jsonb_array_elements(coalesce(${testRuns.result}->'steps', '[]'::jsonb)) s where s->>'via' = 'agent')`.as("agent"),
      cost: sql<string | null>`(${testRuns.result}->>'costUsd')::numeric`.as("cost"),
      n: sql<number>`row_number() over (partition by ${testRuns.testId} order by ${testRuns.createdAt} desc)`.as("n"),
    })
    .from(testRuns)
    .where(and(inArray(testRuns.testId, testIds), inArray(testRuns.status, ["pass", "fail"]), SAYS_SOMETHING))
    .as("recent");
  const rows = await db
    .select({
      testId: recent.testId,
      runs: count(),
      agentRuns: sql<number>`count(*) filter (where ${recent.agent})`.mapWith(Number),
      avgCostUsd: sql<number | null>`avg(${recent.cost})`.mapWith((v) => (v === null || v === undefined ? null : Number(v))),
    })
    .from(recent)
    .where(lte(recent.n, STABILITY_RUNS))
    .groupBy(recent.testId);
  return new Map(rows.map((r) => [r.testId, { runs: r.runs, agentRuns: r.agentRuns, avgCostUsd: r.avgCostUsd }]));
}
