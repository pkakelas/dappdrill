/**
 * Job contract between the web app (producer) and apps/worker (consumer).
 *
 * The web app always writes the row first, then enqueues its id:
 *   "scan.run"        { scanId }   scans row: status "queued", number = next per app, settings snapshot.
 *   "batch.run"       { batchId }  run_batches row: request { flowIds, edgeCases, variationId? }.
 *   "flow-change.run" { changeId } flow_changes row: kind "describe", prompt, flowId (null = new flow).
 * Stopping a scan is not a job: the web sets scans.stop_requested and the worker polls it.
 *
 * Artifacts: a job writes into ARTIFACTS_DIR/<artifactDir(kind, id)>, and every artifact path stored in
 * results (FlowRun.video, Issue.evidence.screenshot, scans.live_frame, "frame" events…) is relative to
 * that directory. The web serves them at /api/artifacts/<kind>/<id>/<path>.
 */
import "server-only";
import { PgBoss } from "pg-boss";

export const QUEUES = {
  scan: "scan.run",
  batch: "batch.run",
  flowChange: "flow-change.run",
} as const;

export interface JobPayloads {
  "scan.run": { scanId: string };
  "batch.run": { batchId: string };
  "flow-change.run": { changeId: string };
}
export type QueueName = keyof JobPayloads;

export type ArtifactKind = "scans" | "batches" | "flow-changes";

export function artifactDir(kind: ArtifactKind, id: string): string {
  return `${kind}/${id}`;
}

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
      await b.createQueue(queue).catch(async (err) => {
        if (!(await b.getQueue(queue))) throw err; // lost a race with the worker: fine
      });
    }
    known.add(queue);
  }
  return b.send(queue, data);
}
