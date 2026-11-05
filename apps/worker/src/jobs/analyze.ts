import { and, eq, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { newId, type AppSetup, type DrillEvent, type SetupDraft, type TestDraft, type TestIdea } from "@dappdrill/core";
import { analyses, apps, nextPosition, notWritten, queueRuns, tests, type Db, type JobStatus } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { errorMessage, logger } from "../log.js";
import { QUEUES, type TestsJob } from "../queues.js";
import { buildTarget, loadApp, targetHints } from "../target.js";
import { serialSink } from "./sink.js";
import { pollStops } from "./stop.js";

type AnalysisRow = typeof analyses.$inferSelect;
const MAX_LOG = 200;

/**
 * analysis.run: look around the app for a couple of minutes, save what it learned,
 * add a happy-path test for the things users most need (and the setup they all need,
 * if any), list the rest under Not tested yet, and run the new tests.
 */
export async function runAnalysis(db: Db, engine: Engine, boss: PgBoss, analysisId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`analysis ${analysisId}`);
  const [row] = await db.select().from(analyses).where(eq(analyses.id, analysisId));
  if (!row) return log.warn("no such analysis; skipping");
  if (row.status !== "queued") return log.warn(`analysis is ${row.status}, not queued; skipping`);
  const update = (patch: Partial<AnalysisRow>) => db.update(analyses).set(patch).where(eq(analyses.id, analysisId));
  if (row.stopRequested) return void (await update({ status: "stopped", finishedAt: new Date() }));

  const app = await loadApp(db, row.appId);
  const stop = new AbortController();
  const stopPolling = pollStops(
    async () => {
      const [r] = await db.select({ stop: analyses.stopRequested }).from(analyses).where(eq(analyses.id, analysisId));
      return r?.stop ? [analysisId] : [];
    },
    () => stop.abort(),
    log,
  );
  const abort = AbortSignal.any([stop.signal, signal]);

  const lines = [...row.log];
  const { sink, drain } = serialSink(async (event: DrillEvent) => {
    if (event.type === "frame") return void (await update({ liveFrame: event.path }));
    if (event.type === "log" && event.level !== "error") {
      lines.push({ at: event.at, text: event.message });
      await update({ log: lines.slice(-MAX_LOG) });
    }
  }, log);

  await update({ status: "running", startedAt: new Date() });
  log.info(`started: ${app.url}`);

  let status: JobStatus = "done";
  let error: string | null = null;
  let created: string[] = [];
  try {
    const known = (await rootTests(db, app.id)).map((t) => (notWritten(t) ? `${t.name} (not written yet)` : t.name));
    const out = await engine.analyze(await buildTarget(db, app, "analysis"), { artifactsDir: artifactsDir("analyses", analysisId), hints: targetHints(app.settings), known }, sink, abort);
    await drain();
    await db
      .update(apps)
      .set({
        ...(out.map ? { map: out.map } : {}),
        ...(out.chains.length ? { chains: out.chains } : {}),
        // A setup the developer already has (maybe edited) wins over a new proposal.
        ...(out.setup && !app.setup ? { setup: setupOf(out.setup) } : {}),
      })
      .where(eq(apps.id, app.id));
    created = await addTests(db, app.id, out.tests, out.untested);
    await update({ blocked: out.blocked ?? null, stalled: out.stalled ?? null, costUsd: out.costUsd });
  } catch (e) {
    await drain();
    error = errorMessage(e);
    if (!abort.aborted) log.error("failed", e);
  } finally {
    stopPolling();
  }
  // A stop wins over whatever the engine did with the abort (return early or throw).
  if (stop.signal.aborted) [status, error] = ["stopped", null];
  else if (signal.aborted) [status, error] = ["failed", "The worker shut down during the analysis."];
  else if (error) status = "failed";
  await update({ status, error, finishedAt: new Date() });
  log.info(`${status}: ${created.length} new tests`);

  // Show the new tests working right away (not after a stop: the developer wanted it to end).
  if (status === "done" && created.length) {
    const batchId = await queueRuns(db, app.id, created, "analysis");
    if (batchId) await boss.send(QUEUES.tests, { batchId } satisfies TestsJob);
  }
}

function setupOf(draft: SetupDraft): AppSetup {
  return { startPath: draft.startPath || "/", steps: draft.steps.map((text) => ({ text })), when: draft.when, why: draft.why };
}

const rootTests = (db: Db, appId: string) => db.select().from(tests).where(and(eq(tests.appId, appId), isNull(tests.baseId)));

/**
 * Adds what the analysis found, matching on name. A draft fills in a test nobody wrote yet and
 * leaves a written one alone; an idea only adds a name the app doesn't have. Returns the tests to run.
 */
async function addTests(db: Db, appId: string, drafts: TestDraft[], ideas: TestIdea[]): Promise<string[]> {
  const existing = await rootTests(db, appId);
  const names = new Set(existing.map((t) => t.name.toLowerCase()));
  const unwritten = new Map(existing.filter(notWritten).map((t) => [t.name.toLowerCase(), t.id]));
  let position = await nextPosition(db, appId);
  const ids: string[] = [];
  for (const { steps, ...draft } of drafts) {
    const key = draft.name.toLowerCase();
    const row = { ...draft, steps: steps.map((text) => ({ text })) };
    const stub = unwritten.get(key);
    if (stub) {
      unwritten.delete(key);
      await db.update(tests).set(row).where(eq(tests.id, stub));
      ids.push(stub);
    } else if (!names.has(key)) {
      names.add(key);
      const id = newId("test");
      await db.insert(tests).values({ id, appId, position: position++, ...row });
      ids.push(id);
    }
  }
  for (const idea of ideas) {
    const key = idea.name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    await db.insert(tests).values({ id: newId("test"), appId, position: position++, ...idea, expected: "", steps: [] });
  }
  return ids;
}
