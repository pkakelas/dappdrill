import path from "node:path";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { noteDone, sentence, type Action, type DrillEventSink, type Test, type TestResult } from "@dappdrill/core";
import { appTests, makes, queueRepair, queueRuns, repairAsk, testOf, testRuns, tests, touched, updateApp, type Db, type RepairState } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import type { PgBoss } from "pg-boss";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger, type Logger } from "../log.js";
import { QUEUES, type RepairJob, type TestsJob } from "../queues.js";
import { appSuite, buildTarget, loadApp, type AppRow } from "../target.js";
import { makeStopAsked, stopSignal, throttle } from "./stop.js";
import { appTurn } from "./turn.js";

const SAVE_EVERY_MS = 1000;

type RepairRow = typeof makes.$inferSelect;
type Part = { startPath: string; steps: Action[] };

/**
 * After a run: one repair for the tests that came back needing it. A test whose result before this
 * one needed repairing too, and that nobody has edited since, was tried already: it is left for a
 * person to start, so a run every day doesn't pay for the same repair every day.
 */
export async function repairAfter(db: Db, boss: PgBoss, appId: string, batchId: string, results: TestResult[]): Promise<void> {
  const stopped = results.filter((r) => r.repairable);
  if (stopped.length === 0) return;
  const ids = stopped.map((r) => r.testId);
  const before = await db
    .selectDistinctOn([testRuns.testId], { testId: testRuns.testId, result: testRuns.result, at: testRuns.createdAt })
    .from(testRuns)
    .where(and(inArray(testRuns.testId, ids), ne(testRuns.batchId, batchId), inArray(testRuns.status, ["passed", "failed", "unverified"])))
    .orderBy(testRuns.testId, desc(testRuns.createdAt));
  const edited = await db.select({ testId: tests.id, at: tests.updatedAt }).from(tests).where(inArray(tests.id, ids));
  const id = await queueRepair(db, appId, repairAsk(newlyStopped(stopped, before, edited)), { afterBatch: batchId });
  if (id) await boss.send(QUEUES.repair, { repairId: id } satisfies RepairJob);
}

/** The results of tests that didn't need repairing the time before, or were edited since that time. */
export function newlyStopped<R extends { testId: string }>(stopped: R[], before: { testId: string; result: Pick<TestResult, "repairable"> | null; at: Date }[], edited: { testId: string; at: Date }[]): R[] {
  return stopped.filter((r) => {
    const was = before.find((b) => b.testId === r.testId);
    const changed = edited.find((e) => e.testId === r.testId)?.at;
    return !was?.result?.repairable || (changed !== undefined && changed > was.at);
  });
}

/**
 * repair.run: write an app's tests as code again. The setup and the reset are recorded where they have
 * no recording or it stopped working, then each test asked for. A test replaces the kept one the moment
 * it is repaired, so stopping keeps what there was. The tests are run once afterwards.
 */
export async function runRepair(db: Db, engine: Engine, boss: PgBoss, repairId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`repair ${repairId}`);
  const [row] = await db.select().from(makes).where(eq(makes.id, repairId));
  if (!row || row.status !== "queued" || !row.state.repair) return log.warn("not a queued repair; skipping");
  const app = await loadApp(db, row.appId);

  // It writes the tests, so it holds the app like a make does: the rest wait their turn.
  const lock = await appTurn(db, boss, app.id, QUEUES.repair, { repairId } satisfies RepairJob, log);
  if (!lock) return;
  let ended: RepairEnd;
  try {
    // Stopped while it waited its turn.
    if (await makeStopAsked(db, repairId)) return void (await db.update(makes).set({ status: "stopped", finishedAt: new Date() }).where(eq(makes.id, repairId)));
    ended = await repair(db, engine, app, row, row.state.repair, signal, log);
  } finally {
    await lock.release();
  }
  // After the lock is let go: on a kept account the run needs it.
  const batchId = await queueRuns(db, app.id, ended.then, "repair");
  if (!batchId) return;
  await db.update(makes).set({ state: { ...ended.state, repair: { ...ended.state.repair, batchId } } }).where(eq(makes.id, repairId));
  await boss.send(QUEUES.tests, { batchId } satisfies TestsJob);
}

/** How a repair was left, and the tests to run afterwards: none when it was stopped or broke. */
interface RepairEnd {
  state: RepairRow["state"] & { repair: RepairState };
  then: string[];
}

async function repair(db: Db, engine: Engine, app: AppRow, row: RepairRow, asked: RepairState, shutdown: AbortSignal, log: Logger): Promise<RepairEnd> {
  const dir = artifactsDir("makes", row.id);
  const state: RepairEnd["state"] = { ...row.state, stage: "making", repair: { ...asked, tests: asked.tests.map((t) => ({ ...t })) } };
  const { repair } = state;
  let costUsd = 0;
  const saving = throttle(SAVE_EVERY_MS, () => db.update(makes).set({ state, costUsd }).where(eq(makes.id, row.id)));
  const save = () => saving.push(undefined);

  const stop = stopSignal(() => makeStopAsked(db, row.id), log);
  const signal = AbortSignal.any([shutdown, stop.signal]);

  const sink: DrillEventSink = (event) => {
    if (event.type === "log" && event.level !== "info") return log[event.level](event.message);
    if (event.type === "cost") costUsd = Math.max(costUsd, event.usd);
    else if (event.type === "frame") state.frame = path.relative(dir, event.path);
    else if (event.type === "did") noteDone((state.log ??= []), event.text, event.at);
    else return;
    save();
  };

  await db.update(makes).set({ status: "running", startedAt: new Date(), state }).where(eq(makes.id, row.id));
  log.info(`started: ${repair.tests.length} tests of ${app.url}`);
  let end: "done" | "stopped" | "failed" = "done";
  let error: string | undefined;
  // The engine doesn't wait for a test to be saved, so the repair does before it says how each ended.
  const keeping: Promise<void>[] = [];
  try {
    const suite = appSuite(app, await appTests(db, app.id));
    const was = new Map(suite.tests.map((t) => [t.id, t]));
    const done = await engine.repairSuite({ target: await buildTarget(db, app, "tests"), suite, artifactsDir: dir, signal, testIds: repair.tests.map((t) => t.testId) }, sink, {
      say: (text) => {
        state.said = text;
        noteDone((state.log ??= []), text);
        save();
      },
      onStart: (testId) => {
        const line = repair.tests.find((t) => t.testId === testId);
        if (line) line.status = "repairing";
        save();
      },
      onTest: ({ testId, test, why }) => {
        const line = repair.tests.find((t) => t.testId === testId);
        if (!line) return;
        keeping.push(
          (async () => {
            const kept = test && was.has(testId) ? await keepRepaired(db, was.get(testId)!, test) : false;
            Object.assign(line, kept ? { status: "repaired", why: undefined } : { status: "not-repaired", why: test ? "It was edited while it was being repaired, so the edit was kept." : why });
            log.info(`${line.name}: ${line.status}${line.why ? `, ${line.why}` : ""}`);
            save();
          })(),
        );
      },
    });
    await Promise.all(keeping);
    costUsd = Math.max(costUsd, done.costUsd);
    repair.setup = await keepPart(db, app.id, "setup", suite.setup, done.setup);
    repair.reset = await keepPart(db, app.id, "reset", suite.reset, done.reset);
  } catch (e) {
    end = stop.signal.aborted ? "stopped" : "failed";
    error = stop.signal.aborted ? undefined : shutdown.aborted ? "The worker shut down while the tests were being repaired." : errorMessage(e);
    if (end === "failed") log.error("failed", e);
  } finally {
    stop.end();
    await Promise.allSettled(keeping);
  }
  // A test never reached stays as it was.
  for (const t of repair.tests) if (t.status === "waiting" || t.status === "repairing") Object.assign(t, { status: "not-repaired", why: end === "done" ? "The repair ended before it got to this test." : undefined });
  state.stage = "done";
  await saving.flush();
  await db.update(makes).set({ status: end, state, costUsd, error, finishedAt: new Date() }).where(eq(makes.id, row.id));
  log.info(`${end}: ${repair.tests.filter((t) => t.status === "repaired").length} of ${repair.tests.length} tests repaired, $${costUsd.toFixed(2)}`);
  const failed = new Set(repair.tests.filter((t) => t.status !== "repaired").map((t) => t.testId));
  return { state, then: end === "done" ? repair.then.filter((id) => !failed.has(id)) : [] };
}

/** What a person reads of a test: its lines' words and its values. A recording isn't part of it. */
const reads = (t: Pick<Test, "steps" | "cleanup" | "values">) => JSON.stringify([t.steps.map(sentence), t.cleanup.map(sentence), t.values]);

/**
 * The repaired test in place of the kept one. Somebody may have edited the test while it was repaired:
 * it is replaced only when it still reads as it did when the repair began. Says whether it was.
 */
async function keepRepaired(db: Db, ran: Test, repaired: Test): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [now] = await tx.select().from(tests).where(eq(tests.id, ran.id)).for("update");
    if (!now || reads(testOf(now)) !== reads(ran)) return false;
    await tx
      .update(tests)
      .set({ startPath: repaired.startPath, values: repaired.values, steps: repaired.steps, cleanup: repaired.cleanup, ...touched() })
      .where(eq(tests.id, ran.id));
    return true;
  });
}

/** The repaired setup or reset in place of the app's, unless the owner changed its lines meanwhile. Says whether it was written. */
async function keepPart(db: Db, appId: string, which: "setup" | "reset", ran: Part | undefined, repaired: Part | undefined): Promise<boolean> {
  if (!repaired) return false;
  const words = (part?: Part) => JSON.stringify(part?.steps.map(sentence));
  let written = false;
  await updateApp(db, appId, ({ suite }) => {
    if (words(suite[which]) !== words(ran)) return undefined;
    written = true;
    return { suite: which === "setup" ? { ...suite, setup: repaired } : { ...suite, reset: repaired } };
  });
  return written;
}
