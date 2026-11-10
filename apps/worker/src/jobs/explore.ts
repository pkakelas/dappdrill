import { and, eq, ne } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { ExploreState, newId, type AppMap, type AppSetup, type DrillEvent, type ExploreSuggestion, type TestRunResult, type TestStep } from "@dappdrill/core";
import { addConditions, appTests, apps, BUG_TEST_NOTE, explorations, nextPosition, queueRuns, testRuns, tests, tryAppLock, type Db, type JobStatus } from "@dappdrill/db";
import type { KnownBug } from "@dappdrill/engine";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir, shareArtifacts } from "../artifacts.js";
import { notifyPass } from "../notify/pass.js";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import { LIVE_RETRY_SECONDS, QUEUES, type ExplorationJob, type TestsJob } from "../queues.js";
import { buildTarget, liveChains, loadApp, targetHints, type AppRow } from "../target.js";
import { serialSink } from "./sink.js";
import { pollStops, throttle } from "./stop.js";

type ExplorationRow = typeof explorations.$inferSelect;

/** Often enough to feel live; the state is a few hundred KB by the end. */
const STATE_EVERY_MS = 1200;

/**
 * exploration.run: one pass over the app. What the look learns is saved first. A test is saved
 * the moment it proves itself and gets a run with its conditions right away, so the page fills
 * while the pass goes on; a test that didn't pass is saved as a draft with the reason.
 */
export async function runExploration(db: Db, engine: Engine, boss: PgBoss, explorationId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`exploration ${explorationId}`);
  const [row] = await db.select().from(explorations).where(eq(explorations.id, explorationId));
  if (!row) return log.warn("no such exploration; skipping");
  if (row.status !== "queued") return log.warn(`exploration is ${row.status}, not queued; skipping`);
  const update = (patch: Partial<ExplorationRow>) => db.update(explorations).set(patch).where(eq(explorations.id, explorationId));
  if (row.stopRequested) return void (await update({ status: "stopped", finishedAt: new Date() }));

  const app = await loadApp(db, row.appId);
  // A live account is one account: jobs on it go one at a time, and the rest wait their turn (the exploration stays queued).
  const lock = liveChains(app) ? await tryAppLock(db, app.id) : undefined;
  if (liveChains(app) && !lock) {
    log.info(`another job is on this app's live chain; looking again in ${LIVE_RETRY_SECONDS}s`);
    await boss.send(QUEUES.exploration, { explorationId } satisfies ExplorationJob, { startAfter: LIVE_RETRY_SECONDS });
    return;
  }
  try {
    await explore(db, engine, boss, row, app, signal, log);
  } finally {
    await lock?.release();
  }
}

async function explore(db: Db, engine: Engine, boss: PgBoss, row: ExplorationRow, app: AppRow, signal: AbortSignal, log: ReturnType<typeof logger>): Promise<void> {
  const explorationId = row.id;
  const update = (patch: Partial<ExplorationRow>) => db.update(explorations).set(patch).where(eq(explorations.id, explorationId));
  const stop = new AbortController();
  const stopPolling = pollStops(
    async () => {
      const [r] = await db.select({ stop: explorations.stopRequested }).from(explorations).where(eq(explorations.id, explorationId));
      return r?.stop ? [explorationId] : [];
    },
    () => stop.abort(),
    log,
  );
  const abort = AbortSignal.any([stop.signal, signal]);

  const state = throttle(STATE_EVERY_MS, (value: ExploreState) => update({ state: value }));
  const { sink, drain } = serialSink(async (event: DrillEvent) => {
    if (event.type === "explore") state.push(ExploreState.parse(event.state));
    else if (event.type === "cost") await update({ costUsd: event.usd });
    else if (event.type === "chains") return;
    else if (event.type === "log" && event.level !== "info") log.warn(event.message);
  }, log);

  const known = await appTests(db, app.id);
  let created = 0;
  const save = async (suggestion: ExploreSuggestion, proof?: TestRunResult) => {
    const ids = await saveTest(db, app.id, suggestion);
    created++;
    // Drafts wait for a person. A proved test shows a real run straight away: the proof itself when
    // there is one, since running it again only repeats it; its conditions run for the first time.
    const [testId, ...conditions] = ids;
    if (testId && proof) await recordProof(db, app.id, testId, proof, artifactsDir("explorations", explorationId));
    const batchId = ids.length ? await queueRuns(db, app.id, proof ? conditions : ids, "explore") : undefined;
    if (batchId) await boss.send(QUEUES.tests, { batchId } satisfies TestsJob);
  };

  await update({ status: "running", startedAt: new Date() });
  log.info(`started: ${app.url}, up to ${row.budgetMinutes} minutes`);

  let status: JobStatus = "done";
  let error: string | null = null;
  // Stopped for something a person can give (a funded account on a live chain): the app page asks for it.
  let asked = false;
  try {
    const out = await engine.explore(
      await buildTarget(db, app, "tests"),
      {
        artifactsDir: artifactsDir("explorations", explorationId),
        budgetMinutes: row.budgetMinutes,
        hints: targetHints(app.settings),
        setup: app.setup ?? undefined,
        slots: config.explorers,
        tests: known.filter((t) => !t.baseId).map((t) => ({ id: t.id, name: t.name, goal: t.goal })),
        bugs: await knownBugs(db, app.id, explorationId),
      },
      {
        onMap: (map, setup) => saveMap(db, app.id, map, setup),
        onTokens: (tokens) => saveTokens(db, app.id, tokens).catch((e) => log.warn(`could not save the wallet's tokens: ${errorMessage(e)}`)),
        onTest: save,
        onSetupSteps: (steps, reset) => saveSetup(db, app.id, steps, reset),
      },
      sink,
      abort,
    );
    await drain();
    await state.flush();
    await update({ state: out.state, blocked: out.blocked ?? null, costUsd: out.costUsd });
    if (out.chains.length) await db.update(apps).set({ chains: out.chains }).where(eq(apps.id, app.id));
    if (out.tokens.length) await saveTokens(db, app.id, out.tokens);
    if (out.state.needs) asked = true;
    else if (out.state.stopped) error = out.state.stopped;
  } catch (e) {
    await drain();
    await state.flush();
    error = errorMessage(e);
    if (!abort.aborted) log.error("failed", e);
  } finally {
    stopPolling();
  }
  if (stop.signal.aborted) [status, error] = ["stopped", null];
  else if (signal.aborted) [status, error] = ["failed", "The worker shut down during the exploration."];
  else if (asked) status = "stopped";
  else if (error) status = "failed";
  await update({ status, error, finishedAt: new Date() });
  log.info(`${status}: ${created} new tests`);
  // The page told whoever started it they could close it. Somebody who stopped it, or a worker that shut down, needs no email.
  const end = status === "done" ? "done" : asked && status === "stopped" ? "asked" : status === "failed" && !signal.aborted ? "failed" : undefined;
  if (end) await notifyPass(db, app, explorationId, end);
}

/**
 * Bugs earlier passes confirmed, so they aren't filed again: the open ones, and the ones somebody
 * dismissed. A fixed bug is left out, so it is filed afresh if it comes back.
 */
async function knownBugs(db: Db, appId: string, but: string): Promise<KnownBug[]> {
  const rows = await db.select({ state: explorations.state, triage: explorations.triage }).from(explorations).where(and(eq(explorations.appId, appId), ne(explorations.id, but)));
  const bugs = new Map<string, KnownBug>();
  for (const row of rows) {
    for (const b of row.state?.bugs ?? []) {
      if (b.status === "confirmed" && row.triage[b.id] !== "fixed") bugs.set(b.name.toLowerCase(), { id: b.id, name: b.name, summary: b.summary });
    }
  }
  return [...bugs.values()];
}

/**
 * What the look gave the test wallet, saved as soon as it is given: every run of the tests needs
 * the same, and the first run starts while the pass is still going. Read again, in case the
 * settings changed meanwhile.
 */
async function saveTokens(db: Db, appId: string, tokens: AppRow["settings"]["tokens"]): Promise<void> {
  const { settings } = await loadApp(db, appId);
  await db.update(apps).set({ settings: { ...settings, tokens } }).where(eq(apps.id, appId));
}

/** What the look learned. A setup the developer already has (maybe edited) wins over a new proposal. */
async function saveMap(db: Db, appId: string, map: AppMap, setup?: AppSetup): Promise<void> {
  const [current] = await db.select({ setup: apps.setup }).from(apps).where(eq(apps.id, appId));
  await db.update(apps).set({ map, ...(setup && !current?.setup ? { setup } : {}) }).where(eq(apps.id, appId));
}

/** Saves a suggested test. Returns what should run next: a proved test and its conditions. */
async function saveTest(db: Db, appId: string, s: ExploreSuggestion): Promise<string[]> {
  const testId = newId("test");
  const proved = s.status === "proved";
  // A test that found a bug is saved failing, tied to the bug: the bug is fixed when it passes.
  const bug = s.status === "bug" ? s.bugId : undefined;
  await db.insert(tests).values({
    id: testId,
    appId,
    bugId: bug,
    name: s.draft.name,
    goal: s.draft.goal,
    expected: s.draft.expected,
    startPath: s.draft.startPath,
    steps: s.steps ?? s.draft.steps.map((text) => ({ text })),
    after: s.after ?? s.draft.after?.map((text) => ({ text })) ?? null,
    position: await nextPosition(db, appId),
    draftNote: proved ? null : bug ? BUG_TEST_NOTE : (s.note ?? "It didn't pass on a clean fork."),
  });
  return proved ? [testId, ...(await addConditions(db, testId, s.conditions))] : [];
}

/** The proof's run as the test's first, with its video and screenshots, under a batch of its own. */
async function recordProof(db: Db, appId: string, testId: string, proof: TestRunResult, from: string): Promise<void> {
  const batchId = newId("batch");
  await shareArtifacts(proof, from, artifactsDir("runs", batchId));
  const now = new Date();
  await db.insert(testRuns).values({ id: newId("run"), appId, testId, batchId, trigger: "explore", status: "pass", result: proof, startedAt: now, finishedAt: now });
}

async function saveSetup(db: Db, appId: string, steps: TestStep[], reset?: TestStep[]): Promise<void> {
  const [current] = await db.select({ setup: apps.setup }).from(apps).where(eq(apps.id, appId));
  if (current?.setup) await db.update(apps).set({ setup: { ...current.setup, steps, ...(reset ? { reset } : {}) } }).where(eq(apps.id, appId));
}
