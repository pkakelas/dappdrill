/**
 * Job contract shared with the web app (apps/web/src/lib/jobs.ts). The web writes the row first,
 * then sends its id:
 *
 *   "analysis.run"   { analysisId }  analyses row, status "queued".
 *   "tests.run"      { batchId }     test_runs rows sharing the batch id, status "queued" (queueRuns in @dappdrill/db).
 *   "test-draft.run" { testId }      tests row with `drafting` = the developer's sentence; forkedFrom set for a fork.
 *   "agent.reply"    { messageId }   agent_messages row, role "agent", status "pending", after the user's message.
 *   "exploration.run" { explorationId } explorations row, status "queued".
 *   "sweep.run"      { explorationId } a finished exploration whose checks get repeated.
 *
 * Stopping is not a job: the web sets stop_requested on the analysis or run and the worker polls it.
 */
import { PgBoss, type Queue } from "pg-boss";

export const QUEUES = {
  analysis: "analysis.run",
  tests: "tests.run",
  draft: "test-draft.run",
  agent: "agent.reply",
  scheduleTick: "schedule.tick",
  exploration: "exploration.run",
  sweep: "sweep.run",
} as const;

export interface AnalysisJob {
  analysisId: string;
}
export interface ExplorationJob {
  explorationId: string;
}
export interface TestsJob {
  batchId: string;
}
export interface DraftJob {
  testId: string;
}
export interface AgentJob {
  messageId: string;
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
  "analysis.run": { retryLimit: 0, expireInSeconds: HOUR / 2 },
  "tests.run": { retryLimit: 0, expireInSeconds: 4 * HOUR },
  "test-draft.run": { retryLimit: 0, expireInSeconds: 600 },
  "agent.reply": { retryLimit: 0, expireInSeconds: HOUR / 4 },
  "schedule.tick": { retryLimit: 0, expireInSeconds: 120, deleteAfterSeconds: HOUR },
  "exploration.run": { retryLimit: 0, expireInSeconds: 3 * HOUR },
  "sweep.run": { retryLimit: 0, expireInSeconds: HOUR },
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
