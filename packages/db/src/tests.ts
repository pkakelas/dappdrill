/**
 * Test operations shared by the web app and the worker.
 * Anything that needs a job returns ids; the caller sends the job.
 */
import { and, asc, count, desc, eq, gte, inArray, max, min, sql, type SQL } from "drizzle-orm";
import { newId, Suite, Test, type Fault, type Verdict } from "@dappdrill/core";
import type { Db } from "./client.js";
import { apps, testRuns, tests, type RunStatus, type Trigger } from "./schema/app.js";

export type TestRow = typeof tests.$inferSelect;
export type TestRunRow = typeof testRuns.$inferSelect;

/** The row as the engine's test. Its id is the row's. */
export function testOf(t: TestRow): Test {
  return Test.parse({ id: t.id, name: t.name, goal: t.goal, startPath: t.startPath, values: t.values, steps: t.steps, cleanup: t.cleanup });
}

/** The app's suite: what it keeps with the app, and these tests. */
export function suiteOf(app: Pick<typeof apps.$inferSelect, "suite">, rows: TestRow[]): Suite {
  return Suite.parse({ ...app.suite, tests: rows.map(testOf) });
}

/** The app's tests in order. */
export async function appTests(db: Db, appId: string): Promise<TestRow[]> {
  return db.select().from(tests).where(eq(tests.appId, appId)).orderBy(asc(tests.position), asc(tests.createdAt));
}

/** Saves a test at the end of the app's list, under a new id. `faults` are what it was kept for failing on. */
export async function addTest(db: Db, appId: string, test: Test, faults: Fault[] = []): Promise<string> {
  const id = newId("test");
  await db.insert(tests).values({ id, appId, name: test.name, goal: test.goal, startPath: test.startPath, values: test.values, steps: test.steps, cleanup: test.cleanup, faults, position: await nextPosition(db, appId) });
  return id;
}

const FINISHED: RunStatus[] = ["passed", "failed", "unverified"];

/** The latest result of each test, whatever its status. */
export async function latestRuns(db: Db, testIds: string[]): Promise<Map<string, TestRunRow>> {
  return newestRuns(db, testIds);
}

/** The latest finished result of each test: what its status reads from. A queued or stopped run doesn't replace it. */
export async function settledRuns(db: Db, testIds: string[]): Promise<Map<string, TestRunRow>> {
  return newestRuns(db, testIds, inArray(testRuns.status, FINISHED));
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
  unverified: number;
  active: number;
  startedAt: Date;
  finishedAt: Date | null;
  /** Another deploy of the app the batch ran against, when it didn't run against the app's own URL. */
  url: string | null;
}

/** The app's runs (batches of results), newest first. Nothing is stored for a batch beyond its results. */
export async function listBatches(db: Db, appId: string, limit = 50): Promise<Batch[]> {
  const n = (status: RunStatus[]) => sql<number>`count(*) filter (where ${inArray(testRuns.status, status)})`.mapWith(Number);
  const rows = await db
    .select({
      batchId: testRuns.batchId,
      trigger: min(testRuns.trigger),
      total: count(),
      passed: n(["passed"]),
      failed: n(["failed"]),
      unverified: n(["unverified"]),
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
      costUsd: sql<number | null>`(${testRuns.result}->>'costUsd')::real`,
      verdicts: sql<Verdict[]>`coalesce((select jsonb_agg(r->>'verdict') from jsonb_array_elements(${testRuns.result}->'signingReviews') r), '[]'::jsonb)`,
    })
    .from(testRuns)
    .where(and(eq(testRuns.appId, appId), gte(testRuns.createdAt, since), inArray(testRuns.status, FINISHED)))
    .orderBy(desc(testRuns.createdAt));
}

/**
 * Queued results for these tests of the app, as one batch (a run). `url` runs the batch against
 * another deploy of the app (a preview, staging) instead of its own URL.
 */
export async function queueRuns(db: Db, appId: string, testIds: string[], trigger: Trigger, url?: string): Promise<string | undefined> {
  if (testIds.length === 0) return undefined;
  const rows = await db.select({ id: tests.id }).from(tests).where(and(eq(tests.appId, appId), inArray(tests.id, testIds)));
  if (rows.length === 0) return undefined;
  const batchId = newId("batch");
  await db.insert(testRuns).values(rows.map((r) => ({ id: newId("run"), appId, testId: r.id, batchId, trigger, url: url ?? null })));
  return batchId;
}

/** The position after the app's last test. */
export async function nextPosition(db: Db, appId: string): Promise<number> {
  const [row] = await db.select({ n: max(tests.position) }).from(tests).where(eq(tests.appId, appId));
  return (row?.n ?? -1) + 1;
}

/** Bumps updated_at; used with every edit of a test. */
export const touched = () => ({ updatedAt: sql`now()` });
