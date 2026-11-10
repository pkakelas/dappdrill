/**
 * Test operations shared by the web app and the worker's assistant tools.
 * Anything that needs a job returns ids; the caller sends the job.
 */
import { and, asc, count, desc, eq, gte, inArray, max, min, sql, type SQL } from "drizzle-orm";
import { conditionInfo, newId, type EdgeCaseId, type TestRunStatus, type TestSpec, type Verdict } from "@dappdrill/core";
import type { Db } from "./client.js";
import { testRuns, tests, type Trigger } from "./schema/app.js";

export type TestRow = typeof tests.$inferSelect;
export type TestRunRow = typeof testRuns.$inferSelect;

/** A condition row reads its name and expected result from the shared list, not from what was stored. */
export function specOf(t: TestRow): TestSpec {
  const info = t.condition ? conditionInfo(t.condition) : undefined;
  return {
    id: t.id,
    name: info?.name ?? t.name,
    goal: t.goal,
    expected: info?.expected ?? t.expected,
    startPath: t.startPath,
    steps: t.steps,
    after: t.after ?? undefined,
    proof: t.proof ?? undefined,
    condition: t.condition ?? undefined,
  };
}

/** Something users do that nobody wrote yet: a name and a goal, under Not tested yet. It can't run. */
export function notWritten(t: Pick<TestRow, "baseId" | "drafting" | "steps">): boolean {
  return !t.baseId && !t.drafting && t.steps.length === 0;
}

/** A condition row runs its base's steps; anything else needs steps of its own. */
export function runnable(t: Pick<TestRow, "baseId" | "drafting" | "steps">): boolean {
  return Boolean(t.baseId) || (!t.drafting && t.steps.length > 0);
}

/** What a test from a sentence is called until the writer names it. */
export function sentenceName(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
}

/** The app's tests in order, each followed by its condition rows. */
export async function appTests(db: Db, appId: string): Promise<TestRow[]> {
  const list = await db.select().from(tests).where(eq(tests.appId, appId)).orderBy(asc(tests.position), asc(tests.createdAt));
  return list.filter((t) => !t.baseId).flatMap((t) => [t, ...list.filter((u) => u.baseId === t.id)]);
}

/** The latest result of each test, whatever its status. */
export async function latestRuns(db: Db, testIds: string[]): Promise<Map<string, TestRunRow>> {
  return newestRuns(db, testIds);
}

const FINISHED: TestRunStatus[] = ["pass", "fail", "error", "skipped"];

/** A run our side broke says nothing about the test, so it never becomes the test's result. */
export const SAYS_SOMETHING = sql`${testRuns.result}->>'blame' is distinct from 'ours'`;

/** The latest finished result of each test: what its status reads from. A queued or stopped run doesn't replace it, nor does one we broke. */
export async function settledRuns(db: Db, testIds: string[]): Promise<Map<string, TestRunRow>> {
  return newestRuns(db, testIds, and(inArray(testRuns.status, FINISHED), SAYS_SOMETHING));
}

async function newestRuns(db: Db, testIds: string[], extra?: SQL): Promise<Map<string, TestRunRow>> {
  if (testIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([testRuns.testId])
    .from(testRuns)
    .where(and(inArray(testRuns.testId, testIds), extra))
    .orderBy(testRuns.testId, desc(testRuns.createdAt));
  return new Map(rows.map((r) => [r.testId, r]));
}

export interface Batch {
  batchId: string;
  trigger: Trigger;
  total: number;
  passed: number;
  failed: number;
  couldntRun: number;
  skipped: number;
  active: number;
  startedAt: Date;
  finishedAt: Date | null;
  /** Another deploy of the app the batch ran against, when it didn't run against the app's own URL. */
  url: string | null;
}

/** The app's runs (batches of results), newest first. Nothing is stored for a batch beyond its results. */
export async function listBatches(db: Db, appId: string, limit = 50): Promise<Batch[]> {
  const n = (status: TestRunStatus[]) => sql<number>`count(*) filter (where ${inArray(testRuns.status, status)})`.mapWith(Number);
  const rows = await db
    .select({
      batchId: testRuns.batchId,
      trigger: min(testRuns.trigger),
      total: count(),
      passed: n(["pass"]),
      failed: n(["fail"]),
      couldntRun: n(["error"]),
      skipped: n(["skipped"]),
      active: n(["queued", "running"]),
      startedAt: min(testRuns.createdAt),
      finishedAt: max(testRuns.finishedAt),
      url: min(testRuns.url),
    })
    .from(testRuns)
    .where(eq(testRuns.appId, appId))
    .groupBy(testRuns.batchId)
    .orderBy(desc(min(testRuns.createdAt)))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    trigger: (r.trigger ?? "manual") as Trigger,
    startedAt: new Date(r.startedAt as unknown as string),
    finishedAt: r.active > 0 || !r.finishedAt ? null : new Date(r.finishedAt as unknown as string),
  }));
}

export type RunSummary = Awaited<ReturnType<typeof runHistory>>[number];

/** An app's finished runs since `since`, newest first, without the heavy result. */
export async function runHistory(db: Db, appId: string, since: Date) {
  return db
    .select({
      id: testRuns.id,
      testId: testRuns.testId,
      status: testRuns.status,
      createdAt: testRuns.createdAt,
      startedAt: testRuns.startedAt,
      finishedAt: testRuns.finishedAt,
      verdicts: sql<Verdict[]>`coalesce((select jsonb_agg(r->>'verdict') from jsonb_array_elements(${testRuns.result}->'signingReviews') r), '[]'::jsonb)`,
    })
    .from(testRuns)
    .where(and(eq(testRuns.appId, appId), gte(testRuns.createdAt, since), inArray(testRuns.status, ["pass", "fail", "error"])))
    .orderBy(desc(testRuns.createdAt));
}

/**
 * Queued results for the tests that can run, as one batch (a run). Condition rows go after
 * their base, so a base that learns its actions in this batch hands them on. `url` runs the
 * batch against another deploy of the app (a preview, staging) instead of its own URL.
 */
export async function queueRuns(db: Db, appId: string, testIds: string[], trigger: Trigger, url?: string): Promise<string | undefined> {
  if (testIds.length === 0) return undefined;
  const rows = (await db.select({ id: tests.id, baseId: tests.baseId, drafting: tests.drafting, steps: tests.steps }).from(tests).where(and(eq(tests.appId, appId), inArray(tests.id, testIds)))).filter(runnable);
  const sorted = [...rows.filter((r) => !r.baseId), ...rows.filter((r) => r.baseId)];
  if (sorted.length === 0) return undefined;
  const batchId = newId("batch");
  await db.insert(testRuns).values(sorted.map((r) => ({ id: newId("run"), appId, testId: r.id, batchId, trigger, url: url ?? null })));
  return batchId;
}

/**
 * Condition rows of a test, one per condition it doesn't have yet. Name and expected are copied
 * from CONDITIONS, though `specOf` always reads them from the list. Returns the new ids.
 */
export async function addConditions(db: Db, baseId: string, conditions: EdgeCaseId[]): Promise<string[]> {
  const [base] = await db.select().from(tests).where(eq(tests.id, baseId));
  if (!base || base.baseId) return [];
  const existing = await db.select({ condition: tests.condition }).from(tests).where(eq(tests.baseId, baseId));
  const fresh = conditions.filter((c) => !existing.some((e) => e.condition === c));
  if (fresh.length === 0) return [];
  const rows = fresh.map((c, i) => ({
    id: newId("test"),
    appId: base.appId,
    name: conditionInfo(c).name,
    goal: base.goal,
    expected: conditionInfo(c).expected,
    startPath: base.startPath,
    steps: [],
    condition: c,
    baseId,
    position: base.position + 1 + existing.length + i,
  }));
  await db.insert(tests).values(rows);
  return rows.map((r) => r.id);
}

/** The position after the app's last test. */
export async function nextPosition(db: Db, appId: string): Promise<number> {
  const [row] = await db.select({ n: max(tests.position) }).from(tests).where(eq(tests.appId, appId));
  return (row?.n ?? -1) + 1;
}

/** On a new test until its first pass. */
export const NEW_TEST_NOTE = "Hasn't passed yet.";

/** On a test that checks a bug, until the bug is fixed and it passes. */
export const BUG_TEST_NOTE = "It checks a bug. It passes once the bug is fixed.";

/** Bumps updated_at; used with every edit of a test. */
export const touched = () => ({ updatedAt: sql`now()` });
