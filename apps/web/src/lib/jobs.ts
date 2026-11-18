/**
 * Job contract between the web app (producer) and apps/worker (consumer); see apps/worker/src/queues.ts.
 *
 * The web app always writes the row first, then enqueues its id:
 *   "tests.run" { batchId }   test_runs rows sharing the batch id (queueRuns in @dappdrill/db).
 *   "make.run"  { makeId }    a makes row, status "queued": with a goal, one test; without, a look and a test per goal.
 *   "repair.run" { repairId } a makes row with `state.repair`, status "queued" (queueRepair in @dappdrill/db).
 * Stopping is not a job: the web sets stop_requested and the worker polls it.
 *
 * Artifacts: a job writes into ARTIFACTS_DIR/<kind>/<id>/ ("runs"/<batchId>, "makes"/<makeId>) and every
 * stored path is relative to that directory. The web serves them at /api/artifacts/<kind>/<id>/<path>.
 */
import "server-only";
import { PgBoss } from "pg-boss";

export interface JobPayloads {
  "tests.run": { batchId: string };
  "make.run": { makeId: string };
  "repair.run": { repairId: string };
}
export type QueueName = keyof JobPayloads;

export type ArtifactKind = "runs" | "makes";

// One send-only pg-boss instance per server process (kept across dev reloads).
const g = globalThis as unknown as { __ddBoss?: Promise<PgBoss>; __ddQueues?: Set<string> };

function boss(): Promise<PgBoss> {
  g.__ddBoss ??= (async () => {
    const b = new PgBoss({ connectionString: process.env.DATABASE_URL!, max: 3, supervise: false, schedule: false });
    b.on("error", (err) => console.error("[pg-boss]", err));
    await b.start();
    return b;
  })().catch((err) => {
    g.__ddBoss = undefined;
    throw err;
  });
  return g.__ddBoss;
}

export async function enqueue<Q extends QueueName>(queue: Q, data: JobPayloads[Q]): Promise<string | null> {
  const b = await boss();
  const known = (g.__ddQueues ??= new Set());
  if (!known.has(queue)) {
    if (!(await b.getQueue(queue))) {
      // The worker brings retry options in line when it starts.
      await b.createQueue(queue, { retryLimit: 0 }).catch(async (err) => {
        if (!(await b.getQueue(queue))) throw err; // lost a race with the worker: fine
      });
    }
    known.add(queue);
  }
  return b.send(queue, data);
}
