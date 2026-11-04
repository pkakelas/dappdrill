/**
 * Test operations shared by the web app and the worker's assistant tools.
 * Anything that needs a job returns ids; the caller sends the job.
 */
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { conditionInfo, newId, type EdgeCaseId, type TestSpec } from "@dappdrill/core";
import type { Db } from "./client.js";
import { flows, testRuns, tests, type Trigger } from "./schema/app.js";

export type TestRow = typeof tests.$inferSelect;
export type FlowRow = typeof flows.$inferSelect;
export type TestRunRow = typeof testRuns.$inferSelect;

export function specOf(t: TestRow): TestSpec {
  return {
    id: t.id,
    name: t.name,
    goal: t.goal,
    expected: t.expected,
    startPath: t.startPath,
    steps: t.steps,
    proof: t.proof ?? undefined,
    condition: t.condition ?? undefined,
  };
}

/** The app's flows in order, each with its tests in order (happy paths before their unhappy ones). */
export async function flowsWithTests(db: Db, appId: string): Promise<(FlowRow & { tests: TestRow[] })[]> {
  const fs = await db.select().from(flows).where(eq(flows.appId, appId)).orderBy(asc(flows.position), asc(flows.createdAt));
  const ts = await db.select().from(tests).where(eq(tests.appId, appId)).orderBy(asc(tests.position), asc(tests.createdAt));
  return fs.map((f) => ({ ...f, tests: ordered(ts.filter((t) => t.flowId === f.id)) }));
}

/** Each test followed by its unhappy paths. */
function ordered(list: TestRow[]): TestRow[] {
  const out: TestRow[] = [];
  for (const t of list.filter((t) => !t.baseId)) out.push(t, ...list.filter((u) => u.baseId === t.id));
  // Unhappy paths whose base is in another flow (shouldn't happen) still show.
  for (const t of list) if (!out.includes(t)) out.push(t);
  return out;
}

/** The latest run of each test. */
export async function latestRuns(db: Db, testIds: string[]): Promise<Map<string, TestRunRow>> {
  if (testIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([testRuns.testId])
    .from(testRuns)
    .where(inArray(testRuns.testId, testIds))
    .orderBy(testRuns.testId, desc(testRuns.createdAt));
  return new Map(rows.map((r) => [r.testId, r]));
}

/**
 * Queued runs for the tests, as one batch. Unhappy paths go after their base,
 * so a base that learns its actions in this batch hands them on.
 */
export async function queueRuns(db: Db, appId: string, testIds: string[], trigger: Trigger): Promise<string | undefined> {
  if (testIds.length === 0) return undefined;
  const rows = await db.select({ id: tests.id, baseId: tests.baseId }).from(tests).where(and(eq(tests.appId, appId), inArray(tests.id, testIds)));
  const sorted = [...rows.filter((r) => !r.baseId), ...rows.filter((r) => r.baseId)];
  if (sorted.length === 0) return undefined;
  const batchId = newId("batch");
  await db.insert(testRuns).values(sorted.map((r) => ({ id: newId("run"), appId, testId: r.id, batchId, trigger })));
  return batchId;
}

/** Unhappy paths of a happy-path test, one per condition it doesn't have yet. Returns the new test ids. */
export async function addUnhappyPaths(db: Db, baseId: string, conditions: EdgeCaseId[]): Promise<string[]> {
  const [base] = await db.select().from(tests).where(eq(tests.id, baseId));
  if (!base || base.baseId) return [];
  const existing = await db.select({ condition: tests.condition }).from(tests).where(eq(tests.baseId, baseId));
  const fresh = conditions.filter((c) => !existing.some((e) => e.condition === c));
  if (fresh.length === 0) return [];
  const rows = fresh.map((c, i) => ({
    id: newId("test"),
    appId: base.appId,
    flowId: base.flowId,
    name: conditionInfo(c)?.name ?? c,
    goal: base.goal,
    expected: conditionInfo(c)?.expected ?? "The app handles it and tells the user what happened.",
    startPath: base.startPath,
    steps: [],
    condition: c,
    baseId,
    position: base.position + 1 + existing.length + i,
  }));
  await db.insert(tests).values(rows);
  return rows.map((r) => r.id);
}

/** Next position at the end of a flow (or of the app's flows when `flowId` is undefined). */
export async function nextPosition(db: Db, appId: string, flowId?: string): Promise<number> {
  const [row] = flowId
    ? await db.select({ n: max(tests.position) }).from(tests).where(eq(tests.flowId, flowId))
    : await db.select({ n: max(flows.position) }).from(flows).where(eq(flows.appId, appId));
  return (row?.n ?? -1) + 1;
}

/** Bumps updated_at; used with every edit of a test. */
export const touched = () => ({ updatedAt: sql`now()` });
