import { and, eq, gt, isNotNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { DEFAULT_EDGE_CASES, newId } from "@dappdrill/core";
import { apps, domains, flows, runBatches, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { logger } from "../log.js";
import { QUEUES, type BatchJob } from "../queues.js";

const log = logger("schedule");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** "HH:MM" in UTC. */
export function utcMinute(at = new Date()): string {
  return at.toISOString().slice(11, 16);
}

/**
 * schedule.tick (every minute): start the daily replay of every app scheduled for this minute.
 * Only apps on a verified domain run unattended (localhost too, in dev).
 */
export async function scheduleTick(db: Db, boss: PgBoss, at = utcMinute()): Promise<string[]> {
  const due = await db.select().from(apps).where(eq(apps.scheduleTime, at));
  const started: string[] = [];
  for (const app of due) {
    if (!(await mayRunUnattended(db, app.teamId, app.host))) {
      log.warn(`${app.name}: ${app.host} is not a verified domain; skipping the scheduled run`);
      continue;
    }
    // A tick can be delivered twice (or two workers can run); one scheduled batch per window is enough.
    const recent = await db
      .select({ id: runBatches.id })
      .from(runBatches)
      .where(and(eq(runBatches.appId, app.id), eq(runBatches.trigger, "schedule"), gt(runBatches.createdAt, new Date(Date.now() - 2 * 60_000))))
      .limit(1);
    if (recent.length) continue;

    const flowIds = (await db.select({ id: flows.id }).from(flows).where(and(eq(flows.appId, app.id), eq(flows.archived, false)))).map((f) => f.id);
    if (flowIds.length === 0) {
      log.info(`${app.name}: no flows to run`);
      continue;
    }
    const batchId = newId("batch");
    const edgeCases = app.settings.edgeCases?.length ? app.settings.edgeCases : DEFAULT_EDGE_CASES;
    await db.insert(runBatches).values({ id: batchId, appId: app.id, trigger: "schedule", request: { flowIds, edgeCases } });
    await boss.send(QUEUES.batch, { batchId } satisfies BatchJob);
    log.info(`${app.name}: scheduled run ${batchId} (${flowIds.length} flows × ${edgeCases.length} edge cases)`);
    started.push(batchId);
  }
  return started;
}

async function mayRunUnattended(db: Db, teamId: string, host: string): Promise<boolean> {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (config.dev && LOCAL_HOSTS.has(hostname)) return true;
  const [verified] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.teamId, teamId), eq(domains.host, hostname), isNotNull(domains.verifiedAt)))
    .limit(1);
  return Boolean(verified);
}
