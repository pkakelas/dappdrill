import { eq } from "drizzle-orm";
import type { DrillEvent, ScanReport } from "@dappdrill/core";
import { scanEvents, scans, type Db, type JobStatus } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import { notifyAfter } from "../notify/index.js";
import { Persister } from "../persist.js";
import { buildTarget, loadApp, loadBaselines, loadKnownFlows } from "../target.js";
import { serialSink } from "./sink.js";

type ScanRow = typeof scans.$inferSelect;

/** scan.run: drill the app and stream everything into the database. */
export async function runScan(db: Db, engine: Engine, scanId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`scan ${scanId}`);
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId));
  if (!scan) return log.warn("no such scan; skipping");
  if (scan.status !== "queued") return log.warn(`scan is ${scan.status}, not queued; skipping`);
  if (scan.stopRequested) {
    await db.update(scans).set({ status: "stopped", finishedAt: new Date() }).where(eq(scans.id, scanId));
    return log.info("stopped before it started");
  }

  const app = await loadApp(db, scan.appId);
  const persister = new Persister(db, { appId: app.id, scanId });
  const state: Pick<ScanRow, "stages" | "pages" | "chains"> = { stages: { ...scan.stages }, pages: [...scan.pages], chains: scan.chains };
  const update = (patch: Partial<ScanRow>) => db.update(scans).set(patch).where(eq(scans.id, scanId));

  // Stop: the web sets stop_requested; we poll it and abort the engine.
  const stop = new AbortController();
  const poll = setInterval(async () => {
    try {
      const [row] = await db.select({ stop: scans.stopRequested }).from(scans).where(eq(scans.id, scanId));
      if (row?.stop && !stop.signal.aborted) {
        log.info("stop requested");
        stop.abort();
      }
    } catch (e) {
      log.warn(`stop poll failed: ${errorMessage(e)}`);
    }
  }, config.stopPollMs);
  const abort = AbortSignal.any([stop.signal, signal]);

  let walletSet = false;
  const { sink, drain } = serialSink(async (event: DrillEvent) => {
    await db.insert(scanEvents).values({ scanId, event });
    switch (event.type) {
      case "stage":
        state.stages[event.stage] = { status: event.status, progress: event.progress };
        return void (await update({ stages: state.stages }));
      case "frame":
        return void (await update({ liveFrame: event.path }));
      case "page": {
        const i = state.pages.findIndex((p) => p.url === event.url);
        const page = { url: event.url, title: event.title };
        if (i >= 0) state.pages[i] = page;
        else state.pages.push(page);
        return void (await update({ pages: state.pages }));
      }
      case "chains":
        state.chains = event.chains;
        return void (await update({ chains: event.chains }));
      case "cost":
        return void (await update({ costUsd: event.usd }));
      case "wallet-request":
        if (!event.request.from || walletSet) return;
        walletSet = true;
        return void (await update({ walletAddress: event.request.from }));
      case "flow":
        return persister.flow(event.flow);
      case "run":
        return persister.run(event.run);
      case "issue":
        return persister.issue(event.issue);
      case "signing-review":
        return persister.review(event.review);
      case "log":
      case "flow-status":
        return;
    }
  }, log);

  await update({ status: "running", startedAt: new Date() });
  log.info(`started: ${app.url}`);

  let status: JobStatus = "done";
  let error: string | null = null;
  let report: ScanReport | undefined;
  try {
    report = await engine.scan(
      await buildTarget(db, app, scan.settings),
      {
        artifactsDir: artifactsDir("scans", scanId),
        maxFlows: scan.settings.maxFlows,
        hints: scan.settings.hints,
        baselines: await loadBaselines(db, app.id),
        knownFlows: await loadKnownFlows(db, app.id),
      },
      sink,
      abort,
    );
    await drain();
    await persister.all(report);
  } catch (e) {
    await drain();
    error = errorMessage(e);
    if (!abort.aborted) log.error("failed", e);
  } finally {
    clearInterval(poll);
  }
  // A stop wins over whatever the engine did with the abort (return early or throw).
  if (stop.signal.aborted) [status, error] = ["stopped", null];
  else if (signal.aborted) [status, error] = ["failed", "The worker shut down during the scan."];
  else if (error) status = "failed";

  await update({ status, error, finishedAt: new Date(), ...(report ? { costUsd: report.costUsd } : {}) });
  log.info(`${status}: ${persister.summary()}`);

  if (status !== "failed") {
    await notifyAfter(db, {
      app,
      what: "scan",
      path: `/apps/${app.id}/scans/${scanId}`,
      persister,
      report: report ?? persister.asReport(app.url),
    }).catch((e) => log.warn(`notifications failed: ${errorMessage(e)}`));
  }
}
