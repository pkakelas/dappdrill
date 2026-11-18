/**
 * Job contract shared with the web app (apps/web/src/lib/jobs.ts). The web writes the row first,
 * then sends its id:
 *
 *   "tests.run"  { batchId }  test_runs rows sharing the batch id, status "queued" (queueRuns in @dappdrill/db).
 *   "make.run"   { makeId }   makes row, status "queued". With a goal it makes that one test; without, it
 *                             looks over the app and makes a test for each goal it finds.
 *   "repair.run" { repairId } makes row whose state has `repair` (the tests to repair), status "queued".
 *                             What is repaired replaces the setup, the reset and the tests as they were.
 *
 * Stopping is not a job: the web sets stop_requested on the make or the runs and the worker polls it.
 */
import { PgBoss, type Queue } from "pg-boss";

export const QUEUES = {
  tests: "tests.run",
  make: "make.run",
  repair: "repair.run",
  scheduleTick: "schedule.tick",
} as const;

export interface TestsJob {
  batchId: string;
}
export interface MakeJob {
  makeId: string;
}
export interface RepairJob {
  repairId: string;
}
/** `at` ("HH:MM" UTC) overrides the current minute; handy for testing. */
export interface ScheduleTickJob {
  at?: string;
}

const HOUR = 3600;

/**
 * Jobs cost money and leave rows behind, so nothing retries automatically:
 * a failed job leaves its row failed with the error.
 */
const QUEUE_OPTIONS: Record<(typeof QUEUES)[keyof typeof QUEUES], Omit<Queue, "name">> = {
  "tests.run": { retryLimit: 0, expireInSeconds: 4 * HOUR },
  "make.run": { retryLimit: 0, expireInSeconds: 6 * HOUR },
  "repair.run": { retryLimit: 0, expireInSeconds: 6 * HOUR },
  "schedule.tick": { retryLimit: 0, expireInSeconds: 120, deleteAfterSeconds: HOUR },
};

/**
 * Queues must exist before send() or work(). One created with other options (the web app creates a
 * queue it sends to before the worker has started) is brought in line with ours.
 */
async function ensureQueues(boss: PgBoss): Promise<void> {
  const existing = new Map((await boss.getQueues()).map((q) => [q.name, q]));
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    const queue = existing.get(name);
    if (!queue) await boss.createQueue(name, options);
    else if (queue.retryLimit !== options.retryLimit || queue.expireInSeconds !== options.expireInSeconds) await boss.updateQueue(name, options);
  }
}

/** A started pg-boss instance with our queues created. */
export async function createBoss(url = process.env.DATABASE_URL): Promise<PgBoss> {
  if (!url) throw new Error("DATABASE_URL is not set");
  const boss = new PgBoss(url);
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  await ensureQueues(boss);
  return boss;
}
