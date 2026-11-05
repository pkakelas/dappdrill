import { createDb } from "@dappdrill/db";
import { loadEngine } from "@dappdrill/engine/fake";
import type { Job } from "pg-boss";
import { config } from "./config.js";
import { runAgentReply } from "./jobs/agent.js";
import { runAnalysis } from "./jobs/analyze.js";
import { runDraft } from "./jobs/draft.js";
import { runExploration, runSweep } from "./jobs/explore.js";
import { scheduleTick } from "./jobs/schedule.js";
import { runTestBatch } from "./jobs/tests.js";
import { errorMessage, logger } from "./log.js";
import { createBoss, QUEUES, type AgentJob, type AnalysisJob, type DraftJob, type ExplorationJob, type ScheduleTickJob, type TestsJob } from "./queues.js";

const log = logger("worker");
const SHUTDOWN_GRACE_MS = 30_000;

async function main() {
  const db = createDb();
  const engine = await loadEngine();
  const boss = await createBoss();
  // Aborted on shutdown so in-flight jobs stop and record why.
  const shutdown = new AbortController();

  /** Runs each job with a signal that fires on shutdown or when pg-boss gives up on it. */
  const each =
    <T>(handle: (data: T, signal: AbortSignal) => Promise<unknown>) =>
    async (jobs: Job<T>[]) => {
      for (const job of jobs) await handle(job.data, AbortSignal.any([shutdown.signal, job.signal]));
    };

  await boss.work<AnalysisJob>(QUEUES.analysis, { localConcurrency: config.analysisConcurrency }, each((d, s) => runAnalysis(db, engine, boss, d.analysisId, s)));
  await boss.work<TestsJob>(QUEUES.tests, { localConcurrency: config.testsConcurrency }, each((d, s) => runTestBatch(db, engine, d.batchId, s)));
  await boss.work<DraftJob>(QUEUES.draft, { localConcurrency: config.chatConcurrency }, each((d) => runDraft(db, engine, boss, d.testId)));
  await boss.work<AgentJob>(QUEUES.agent, { localConcurrency: config.chatConcurrency }, each((d, s) => runAgentReply(db, engine, boss, d.messageId, s)));
  await boss.work<ExplorationJob>(QUEUES.exploration, { localConcurrency: config.explorationConcurrency }, each((d, s) => runExploration(db, engine, boss, d.explorationId, s)));
  await boss.work<ExplorationJob>(QUEUES.sweep, each((d, s) => runSweep(db, engine, d.explorationId, s)));
  await boss.work<ScheduleTickJob>(QUEUES.scheduleTick, each((d) => scheduleTick(db, boss, d?.at)));
  await boss.schedule(QUEUES.scheduleTick, "* * * * *");

  log.info(
    `ready: ${process.env.DAPPDRILL_FAKE_ENGINE === "1" ? "fake" : "real"} engine, ` +
      `concurrency analyses ${config.analysisConcurrency} / test batches ${config.testsConcurrency} / chat ${config.chatConcurrency}, ` +
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
