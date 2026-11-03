import { createDb } from "@dappdrill/db";
import { loadEngine } from "@dappdrill/engine/fake";
import type { Job } from "pg-boss";
import { config } from "./config.js";
import { runBatch } from "./jobs/batch.js";
import { runFlowChange } from "./jobs/flow-change.js";
import { scheduleTick } from "./jobs/schedule.js";
import { runScan } from "./jobs/scan.js";
import { errorMessage, logger } from "./log.js";
import { createBoss, QUEUES, type BatchJob, type FlowChangeJob, type ScanJob, type ScheduleTickJob } from "./queues.js";

const log = logger("worker");
const SHUTDOWN_GRACE_MS = 30_000;

async function main() {
  const db = createDb();
  const engine = await loadEngine();
  const boss = await createBoss();
  // Aborted on shutdown so in-flight scans stop and record why.
  const shutdown = new AbortController();

  /** Runs each job with a signal that fires on shutdown or when pg-boss gives up on it. */
  const each =
    <T>(handle: (data: T, signal: AbortSignal) => Promise<unknown>) =>
    async (jobs: Job<T>[]) => {
      for (const job of jobs) await handle(job.data, AbortSignal.any([shutdown.signal, job.signal]));
    };

  await boss.work<ScanJob>(QUEUES.scan, { localConcurrency: config.scanConcurrency }, each((d, s) => runScan(db, engine, d.scanId, s)));
  await boss.work<BatchJob>(QUEUES.batch, { localConcurrency: config.batchConcurrency }, each((d, s) => runBatch(db, engine, d.batchId, s)));
  await boss.work<FlowChangeJob>(
    QUEUES.flowChange,
    { localConcurrency: config.flowChangeConcurrency },
    each((d, s) => runFlowChange(db, engine, d.changeId, s)),
  );
  await boss.work<ScheduleTickJob>(QUEUES.scheduleTick, each((d) => scheduleTick(db, boss, d?.at)));
  await boss.schedule(QUEUES.scheduleTick, "* * * * *");

  log.info(
    `ready: ${process.env.DAPPDRILL_FAKE_ENGINE === "1" ? "fake" : "real"} engine, ` +
      `concurrency scans ${config.scanConcurrency} / runs ${config.batchConcurrency} / flow changes ${config.flowChangeConcurrency}, ` +
      `artifacts in ${config.artifactsRoot}`,
  );

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) {
      log.warn("second signal; exiting now");
      process.exit(1);
    }
    stopping = true;
    log.info(`${signal}: stopping; in-flight jobs are told to wrap up`);
    shutdown.abort(new Error("worker shutting down"));
    try {
      await boss.stop({ graceful: true, timeout: SHUTDOWN_GRACE_MS });
    } catch (e) {
      log.error(`pg-boss did not stop cleanly: ${errorMessage(e)}`);
    }
    log.info("stopped");
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

main().catch((e) => {
  log.error("could not start", e);
  process.exit(1);
});
