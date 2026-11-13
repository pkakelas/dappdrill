import path from "node:path";
import { eq } from "drizzle-orm";
import { MakeState, newId, sentence, setupWithRecordings, type DrillEventSink, type Tried, type Fault, type LineResult, type MakeGoal, type Suite, type TestResult } from "@dappdrill/core";
import { addTest, apps, appTests, makes, suiteOf, testRuns, tryAppLock, type Db } from "@dappdrill/db";
import type { Attempt, Looked } from "@dappdrill/engine";
import type { Engine } from "@dappdrill/engine/fake";
import type { PgBoss } from "pg-boss";
import { artifactsDir, shareArtifacts } from "../artifacts.js";
import { errorMessage, logger, type Logger } from "../log.js";
import { notifyMake } from "../notify/make.js";
import { LIVE_RETRY_SECONDS, QUEUES, type MakeJob } from "../queues.js";
import { buildTarget, loadApp, ownerNotes, type AppRow } from "../target.js";
import { pollStops, throttle } from "./stop.js";

const SAVE_EVERY_MS = 1000;

/**
 * make.run: make tests for an app. With a goal it makes that one test. Without, it looks over the
 * app and makes a test for each goal it finds, most important first. A test is saved the moment it
 * is proven, so stopping keeps what there was.
 */
export async function runMake(db: Db, engine: Engine, boss: PgBoss, makeId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`make ${makeId}`);
  const [row] = await db.select().from(makes).where(eq(makes.id, makeId));
  if (!row || row.status !== "queued") return log.warn("not queued; skipping");
  const app = await loadApp(db, row.appId);

  // Makes on an app go one at a time, and so do all jobs on a live account: the rest wait their turn.
  const lock = await tryAppLock(db, app.id);
  if (!lock) {
    log.info(`another job is on this app; looking again in ${LIVE_RETRY_SECONDS}s`);
    await boss.send(QUEUES.make, { makeId } satisfies MakeJob, { startAfter: LIVE_RETRY_SECONDS });
    return;
  }
  try {
    // Stopped while it waited its turn.
    const [now] = await db.select({ stop: makes.stopRequested }).from(makes).where(eq(makes.id, makeId));
    if (now?.stop) return void (await db.update(makes).set({ status: "stopped", finishedAt: new Date() }).where(eq(makes.id, makeId)));
    await make(db, engine, app, row, signal, log);
  } finally {
    await lock.release();
  }
}

async function make(db: Db, engine: Engine, app: AppRow, row: typeof makes.$inferSelect, shutdown: AbortSignal, log: Logger): Promise<void> {
  const dir = artifactsDir("makes", row.id);
  const state = MakeState.parse(row.goal ? { stage: "making", goals: [{ goal: row.goal, status: "making" }] } : {});
  let costUsd = 0;
  const saving = throttle(SAVE_EVERY_MS, () => db.update(makes).set({ state, costUsd }).where(eq(makes.id, row.id)));
  const save = () => saving.push(undefined);

  const stop = new AbortController();
  const stopPolling = pollStops(
    async () => ((await db.select({ stop: makes.stopRequested }).from(makes).where(eq(makes.id, row.id)))[0]?.stop ? [row.id] : []),
    () => stop.abort(),
    log,
  );
  const signal = AbortSignal.any([shutdown, stop.signal]);

  // A picture of a browser belongs to the look or to the make whose folder it is in.
  const sink: DrillEventSink = (event) => {
    if (event.type === "log" && event.level !== "info") return log[event.level](event.message);
    if (event.type !== "frame") return;
    const rel = path.relative(dir, event.path);
    const n = /^make-(\d+)\//.exec(rel)?.[1];
    const goal = n ? state.goals[Number(n) - 1] : undefined;
    if (goal) goal.frame = rel;
    else if (!n) state.frame = rel;
    save();
  };
  const say = (text: string, n?: number) => {
    const goal = n ? state.goals[n - 1] : undefined;
    if (goal) goal.said = text;
    else if (!n) state.said = text;
    save();
  };

  /** One batch holds the run that proved each test, so a new test shows a result from the start. */
  const batchId = newId("batch");
  const made = async (attempt: Attempt, n: number) => {
    const goal = state.goals[n - 1]!;
    const { made } = attempt;
    costUsd += made?.costUsd ?? 0;
    if (made?.stuck) {
      // The setup stopped before the goal was touched: it is still to be tried, and the make says why once.
      Object.assign(goal, { status: "waiting", said: undefined, frame: undefined, costUsd: made.costUsd, durationMs: made.durationMs } satisfies Partial<MakeGoal>);
      state.stuck = made.stuck;
      log.info(`stopped at the setup, before “${attempt.goal}”: ${attempt.why}`);
      return save();
    }
    Object.assign(goal, {
      status: attempt.kept ? "kept" : "not-kept",
      whyNot: attempt.kept ? undefined : attempt.why,
      tried: attempt.kept ? undefined : tried(made),
      costUsd: made?.costUsd ?? 0,
      durationMs: made?.durationMs ?? 0,
    } satisfies Partial<MakeGoal>);
    if (attempt.kept && made?.test) {
      const faults: Fault[] = made.stands === "failed" ? made.findings.filter((f) => f.proven).map(({ what, expected, saw }) => ({ what, expected, saw })) : [];
      goal.testId = await addTest(db, app.id, made.test, faults);
      goal.stands = made.stands;
      const proof = made.runs.at(-1);
      if (proof) await keepProof(db, app.id, goal.testId, batchId, proof, dir, `make-${n}`).catch((e) => log.warn(`could not keep the run that proved “${made.test!.name}”: ${errorMessage(e)}`));
      log.info(`${made.test.name}: kept, ${made.stands}`);
    } else log.info(`no test for “${attempt.goal}”: ${attempt.why}`);
    save();
  };

  await db.update(makes).set({ status: "running", startedAt: new Date(), state }).where(eq(makes.id, row.id));
  const suite = { ...suiteOf(app, await appTests(db, app.id)), ...ownerNotes(app) };
  log.info(row.goal ? `started: “${row.goal}” on ${app.url}` : `started: up to ${row.count} tests for ${app.url}`);
  let end: "done" | "stopped" | "failed" = "done";
  let error: string | undefined;
  try {
    if (row.goal) {
      const one = await engine.makeTest({ target: await buildTarget(db, app, "tests"), suite, goal: row.goal, artifactsDir: path.join(dir, "make-1"), signal }, sink, (text) => say(text, 1));
      await keepSetup(db, app.id, one.setup);
      const kept = one.proven && !!one.test;
      if (kept) await keepNotes(db, app.id, one.notes, "maker");
      await made({ goal: row.goal, made: one, kept, why: one.why }, 1);
    } else {
      await engine.makeTests({ target: await buildTarget(db, app, "look"), suite, count: row.count, artifactsDir: dir, signal }, sink, {
        say,
        onLooked: (looked) => {
          costUsd += looked.costUsd;
          Object.assign(state, {
            stage: "making",
            summary: looked.summary,
            why: looked.goals.length ? undefined : looked.why,
            stuck: looked.stuck,
            goals: looked.goals.slice(0, row.count).map((g) => ({ ...g, status: "waiting", costUsd: 0, durationMs: 0 })),
          } satisfies Partial<MakeState>);
          save();
          void keepLooked(db, app.id, looked).catch((e) => log.warn(`could not keep what the look found: ${errorMessage(e)}`));
        },
        onGoal: (goal, n, suspicion) => {
          // The look's goals are listed already; what looked wrong on the way is added as it comes up.
          if (state.goals[n - 1]) state.goals[n - 1]!.status = "making";
          else state.goals[n - 1] = { goal, startPath: "/", suspicion: suspicion?.what, status: "making", costUsd: 0, durationMs: 0 };
          save();
        },
        onAttempt: made,
        onSuite: (next) => keepNotes(db, app.id, notesFrom(next, "look"), "look").then(() => keepNotes(db, app.id, notesFrom(next, "maker"), "maker")),
      });
    }
  } catch (e) {
    end = stop.signal.aborted ? "stopped" : "failed";
    error = stop.signal.aborted ? undefined : shutdown.aborted ? "The worker shut down while the tests were being made." : errorMessage(e);
    if (end === "failed") log.error("failed", e);
  } finally {
    stopPolling();
  }
  state.stage = "done";
  await saving.flush();
  await db.update(makes).set({ status: end, state, costUsd, error, finishedAt: new Date() }).where(eq(makes.id, row.id));
  log.info(`${end}: ${state.goals.filter((g) => g.status === "kept").length} tests kept, $${costUsd.toFixed(2)}`);
  if (end !== "stopped") await notifyMake(db, app, row.id, end);
}

const notesFrom = (suite: Suite, from: "look" | "maker") => suite.notes.filter((n) => n.from === from).map((n) => n.text);

/** Adds what was learned about the app to its notes. The owner may have edited them meanwhile, so only what isn't there is added. */
async function keepNotes(db: Db, appId: string, notes: string[], from: "look" | "maker"): Promise<void> {
  if (!notes.length) return;
  const { suite } = await loadApp(db, appId);
  const known = new Set(suite.notes.map((n) => n.text));
  const added = notes.filter((text) => !known.has(text)).map((text) => ({ text, from }));
  if (added.length)
    await db
      .update(apps)
      .set({ suite: { ...suite, notes: [...suite.notes, ...added] } })
      .where(eq(apps.id, appId));
}

/** The setup's actions as a run recorded them, so the next run replays them without a model. */
async function keepSetup(db: Db, appId: string, lines: LineResult[] | undefined): Promise<void> {
  if (!lines?.length) return;
  const { suite } = await loadApp(db, appId);
  if (!suite.setup || suite.setup.steps.length !== lines.length) return;
  await db
    .update(apps)
    .set({ suite: { ...suite, setup: setupWithRecordings(suite.setup, lines) } })
    .where(eq(apps.id, appId));
}

/** The chains the app turned out to use and the tokens the wallet was given: every run starts from these. */
async function keepLooked(db: Db, appId: string, looked: Looked): Promise<void> {
  await keepSetup(db, appId, looked.setup);
  if (!looked.goals.length) return;
  const app = await loadApp(db, appId);
  await db
    .update(apps)
    .set({ chains: looked.chains, settings: { ...app.settings, tokens: looked.tokens } })
    .where(eq(apps.id, appId));
}

/**
 * The last run that proved a test becomes the test's first result. Its pictures are under the
 * make's folder, so they are shared with the batch under the same folder name.
 */
async function keepProof(db: Db, appId: string, testId: string, batchId: string, run: TestResult, makeDir: string, folder: string): Promise<void> {
  const under = (file?: string) => (file ? path.join(folder, file) : undefined);
  const lines = (all: LineResult[]) => all.map((l) => ({ ...l, screenshot: under(l.screenshot) }));
  const result: TestResult = {
    ...run,
    testId,
    steps: lines(run.steps),
    cleanup: lines(run.cleanup),
    video: under(run.video),
    signingReviews: run.signingReviews.map((r) => ({ ...r, testId, ui: { ...r.ui, screenshot: under(r.ui.screenshot) } })),
  };
  await shareArtifacts(result, makeDir, artifactsDir("runs", batchId));
  const now = new Date();
  await db.insert(testRuns).values({ id: newId("run"), appId, testId, batchId, trigger: "make", status: result.outcome, result, startedAt: new Date(now.getTime() - result.durationMs), finishedAt: now });
}

/** What was tried for a goal that got no test, for its page: the test as it last stood and how its lines went in the runs of that wording. */
function tried(made: Attempt["made"]): Tried | undefined {
  if (!made) return undefined;
  const runs = made.runs.slice(made.runs.length - (made.worded ?? 0));
  const last = runs.at(-1);
  return {
    name: made.test?.name,
    lines: (made.test?.steps ?? []).map((line, i) => {
      const at = last?.steps[i];
      return { type: line.type, text: sentence(line), runs: runs.map((r) => r.steps[i]?.status ?? "skipped"), note: at && at.status !== "pass" && at.status !== "skipped" ? at.note || undefined : undefined };
    }),
    runs: made.runs.length,
    ask: made.ask,
  };
}
