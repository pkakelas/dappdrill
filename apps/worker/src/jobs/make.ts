import path from "node:path";
import { eq } from "drizzle-orm";
import { MakeState, newId, noteDone, sentence, setupWithRecordings, withNotes, type DrillEventSink, type Tried, type Fault, type LineResult, type MakeGoal, type Suite, type TestResult } from "@dappdrill/core";
import { addTest, appTests, makes, testRuns, updateApp, type Db } from "@dappdrill/db";
import type { Attempt, Looked } from "@dappdrill/engine";
import type { Engine } from "@dappdrill/engine/fake";
import type { PgBoss } from "pg-boss";
import { artifactsDir, shareArtifacts } from "../artifacts.js";
import { errorMessage, logger, type Logger } from "../log.js";
import { notifyMake } from "../notify/make.js";
import { QUEUES, type MakeJob } from "../queues.js";
import { appSuite, buildTarget, loadApp, type AppRow } from "../target.js";
import { makeStopAsked, stopSignal, throttle } from "./stop.js";
import { appTurn } from "./turn.js";

const SAVE_EVERY_MS = 1000;

/**
 * make.run: make tests for an app. With a goal it makes that one test. Without, it looks over the
 * app and makes a test for each goal it finds, most important first. A test is saved the moment it
 * is proven, so stopping keeps what there was.
 */
export async function runMake(db: Db, engine: Engine, boss: PgBoss, makeId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`make ${makeId}`);
  const [row] = await db.select().from(makes).where(eq(makes.id, makeId));
  if (!row || row.status !== "queued" || row.state.repair) return log.warn("not a queued make; skipping");
  const app = await loadApp(db, row.appId);

  // Makes and repairs on an app go one at a time, and so do all jobs on a kept account: the rest wait their turn.
  const lock = await appTurn(db, boss, app.id, QUEUES.make, { makeId } satisfies MakeJob, log);
  if (!lock) return;
  try {
    // Stopped while it waited its turn.
    if (await makeStopAsked(db, makeId)) return void (await db.update(makes).set({ status: "stopped", finishedAt: new Date() }).where(eq(makes.id, makeId)));
    await make(db, engine, app, row, signal, log);
  } finally {
    await lock.release();
  }
}

async function make(db: Db, engine: Engine, app: AppRow, row: typeof makes.$inferSelect, shutdown: AbortSignal, log: Logger): Promise<void> {
  const dir = artifactsDir("makes", row.id);
  const state = MakeState.parse(row.goal ? { stage: "making", goals: [{ goal: row.goal, status: "making" }] } : {});
  /** What the look and each make came back with. */
  let costUsd = 0;
  /** What the engine says was spent so far, the makes that were stopped or broke included. */
  let reported = 0;
  const spent = () => Math.max(costUsd, reported);
  const saving = throttle(SAVE_EVERY_MS, () => db.update(makes).set({ state, costUsd: spent() }).where(eq(makes.id, row.id)));
  const save = () => saving.push(undefined);

  const stop = stopSignal(() => makeStopAsked(db, row.id), log);
  const signal = AbortSignal.any([shutdown, stop.signal]);

  // A picture of a browser, and what was done in one, belong to the look or to the make whose folder they are in.
  const sink: DrillEventSink = (event) => {
    if (event.type === "log" && event.level !== "info") return log[event.level](event.message);
    if (event.type === "cost") {
      reported = Math.max(reported, event.usd);
      return save();
    }
    if (event.type !== "frame" && event.type !== "did") return;
    const rel = path.relative(dir, event.type === "frame" ? event.path : event.dir);
    const n = /^make-(\d+)(\/|$)/.exec(rel)?.[1];
    const of = n ? state.goals[Number(n) - 1] : state;
    if (!of) return;
    if (event.type === "frame") of.frame = rel;
    else noteDone((of.log ??= []), event.text, event.at);
    save();
  };
  const say = (text: string, n?: number) => {
    const of = n ? state.goals[n - 1] : state;
    if (!of) return;
    of.said = text;
    noteDone((of.log ??= []), text);
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
      Object.assign(goal, { status: "waiting", said: undefined, frame: undefined, log: undefined, costUsd: made.costUsd, durationMs: made.durationMs } satisfies Partial<MakeGoal>);
      state.stuck = made.stuck;
      log.info(`stopped at the setup, before “${attempt.goal}”: ${attempt.why}`);
      return save();
    }
    Object.assign(goal, {
      status: attempt.kept ? "kept" : "not-kept",
      whyNot: attempt.kept ? undefined : attempt.why,
      tried: attempt.kept ? undefined : tried(attempt),
      log: undefined,
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
  log.info(row.goal ? `started: “${row.goal}” on ${app.url}` : `started: up to ${row.count} tests for ${app.url}`);
  let end: "done" | "stopped" | "failed" = "done";
  let error: string | undefined;
  try {
    // In here, so a test that can't be read ends the make failed, with why, rather than leaving it running.
    const suite = appSuite(app, await appTests(db, app.id));
    if (row.goal) {
      const one = await engine.makeTest({ target: await buildTarget(db, app, "tests"), suite, goal: row.goal, artifactsDir: path.join(dir, "make-1"), signal }, sink, (text) => say(text, 1));
      await keepSetup(db, app.id, one.setup);
      const kept = one.proven && !!one.test;
      // What a goal that wasn't kept learned, and what was in its way, is kept as less sure.
      await keepNotes(db, app.id, one.blocker ? [...one.notes, one.blocker] : one.notes, kept ? "maker" : "unkept");
      await made({ goal: row.goal, made: one, kept, why: one.why, ask: one.ask }, 1);
    } else {
      const all = await engine.makeTests({ target: await buildTarget(db, app, "look"), suite, count: row.count, artifactsDir: dir, signal }, sink, {
        say,
        onLooked: async (looked) => {
          costUsd += looked.costUsd;
          Object.assign(state, {
            stage: "making",
            summary: looked.summary,
            why: looked.goals.length ? undefined : looked.why,
            stuck: looked.stuck,
            goals: looked.goals.slice(0, row.count).map((g) => ({ ...g, status: "waiting", costUsd: 0, durationMs: 0 })),
          } satisfies Partial<MakeState>);
          save();
          await keepLooked(db, app.id, looked).catch((e) => log.warn(`could not keep what the look found: ${errorMessage(e)}`));
        },
        onGoal: (goal, n, suspicion) => {
          // The look's goals are listed already; what looked wrong on the way is added as it comes up.
          if (state.goals[n - 1]) state.goals[n - 1]!.status = "making";
          else state.goals[n - 1] = { goal, startPath: "/", suspicion: suspicion?.what, status: "making", costUsd: 0, durationMs: 0 };
          save();
        },
        onAttempt: made,
        onSuite: async (next) => {
          for (const from of ["look", "maker", "unkept"] as const) await keepNotes(db, app.id, notesFrom(next, from), from);
        },
      });
      // No more goals were started: the make says why, and so does each goal not started.
      if (all.stopped) {
        state.why = all.stopped;
        for (const goal of state.goals) if (goal.status === "waiting") Object.assign(goal, { status: "not-kept", whyNot: all.stopped } satisfies Partial<MakeGoal>);
      }
    }
  } catch (e) {
    end = stop.signal.aborted ? "stopped" : "failed";
    error = stop.signal.aborted ? undefined : shutdown.aborted ? "The worker shut down while the tests were being made." : errorMessage(e);
    if (end === "failed") log.error("failed", e);
  } finally {
    stop.end();
  }
  state.stage = "done";
  await saving.flush();
  await db.update(makes).set({ status: end, state, costUsd: spent(), error, finishedAt: new Date() }).where(eq(makes.id, row.id));
  log.info(`${end}: ${state.goals.filter((g) => g.status === "kept").length} tests kept, $${spent().toFixed(2)}`);
  if (end !== "stopped") await notifyMake(db, app, row.id, end);
}

type LearnedFrom = "look" | "maker" | "unkept";
const notesFrom = (suite: Suite, from: LearnedFrom) => suite.notes.filter((n) => n.from === from).map((n) => n.text);

/**
 * Adds what was learned about the app to its notes. The owner may have edited them meanwhile, so
 * only what isn't there is added, and one a test that wasn't kept learned becomes sure when a kept one learns it too.
 */
async function keepNotes(db: Db, appId: string, notes: string[], from: LearnedFrom): Promise<void> {
  if (!notes.length) return;
  await updateApp(db, appId, ({ suite }) => {
    const next = withNotes(suite.notes, notes, from);
    return JSON.stringify(next) !== JSON.stringify(suite.notes) ? { suite: { ...suite, notes: next } } : undefined;
  });
}

/**
 * Saves the browser actions a model took for the setup while tests were made, so a run replays them.
 * Nothing is saved when the setup has been changed to another number of lines meanwhile.
 */
async function keepSetup(db: Db, appId: string, lines: LineResult[] | undefined): Promise<void> {
  if (!lines?.some((s) => s.recorded?.length)) return;
  await updateApp(db, appId, ({ suite }) => (suite.setup && suite.setup.steps.length === lines.length ? { suite: { ...suite, setup: setupWithRecordings(suite.setup, lines) } } : undefined));
}

/** The setup as it was done, and the chains the app turned out to use: every run starts from these. */
async function keepLooked(db: Db, appId: string, looked: Looked): Promise<void> {
  await keepSetup(db, appId, looked.setup);
  if (!looked.goals.length) return;
  await updateApp(db, appId, () => ({ chains: looked.chains }));
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
function tried({ made, ask }: Attempt): Tried | undefined {
  // Not tried: another goal met what would stop it, and its question is this one's too.
  if (!made) return ask ? { lines: [], runs: 0, ask } : undefined;
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
