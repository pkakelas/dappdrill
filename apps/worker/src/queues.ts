/**
 * Job contract shared with the web app. The web inserts the row first, then sends the job:
 *
 *   import { createBoss, QUEUES } from "@dappdrill/worker";
 *   const boss = await createBoss();
 *   await boss.send(QUEUES.scan, { scanId } satisfies ScanJob);
 */
import { PgBoss, type Queue } from "pg-boss";

export const QUEUES = {
  scan: "scan.run",
  batch: "batch.run",
  flowChange: "flow-change.run",
  scheduleTick: "schedule.tick",
} as const;

export interface ScanJob {
  scanId: string;
}
export interface BatchJob {
  batchId: string;
}
export interface FlowChangeJob {
  changeId: string;
}
/** `at` ("HH:MM" UTC) overrides the current minute; handy for testing. */
export interface ScheduleTickJob {
  at?: string;
}

const HOUR = 3600;

/**
 * Scans and replays are expensive and have side effects (artifacts, rows), so nothing
 * retries automatically: a failed job leaves its row as failed with the error.
 */
const QUEUE_OPTIONS: Record<(typeof QUEUES)[keyof typeof QUEUES], Omit<Queue, "name">> = {
  "scan.run": { retryLimit: 0, expireInSeconds: 4 * HOUR },
  "batch.run": { retryLimit: 0, expireInSeconds: 2 * HOUR },
  "flow-change.run": { retryLimit: 0, expireInSeconds: HOUR / 2 },
  "schedule.tick": { retryLimit: 0, expireInSeconds: 120, deleteAfterSeconds: HOUR },
};

/**
 * Queues must exist before send() or work(). Safe to call from every process. A queue someone
 * else created with pg-boss defaults (2 retries) is brought in line with our options.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
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
