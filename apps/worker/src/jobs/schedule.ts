import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { apps, domains, queueRuns, testRuns, tests, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { logger } from "../log.js";
import { QUEUES, type TestsJob } from "../queues.js";

const log = logger("schedule");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** "HH:MM" in UTC. */
export function utcMinute(at = new Date()): string {
  return at.toISOString().slice(11, 16);
}

/**
 * schedule.tick (every minute): run every test of each app scheduled for this minute.
 * Only apps on a verified domain run unattended (localhost too, in dev).
 */
export async function scheduleTick(db: Db, boss: PgBoss, at = utcMinute()): Promise<string[]> {
  const due = await db.select().from(apps).where(eq(apps.scheduleTime, at));
  const started: string[] = [];
  for (const app of due) {
    if (!(await mayRunUnattended(db, app.organizationId, app.host))) {
      log.warn(`${app.name}: ${app.host} is not a verified domain; skipping the scheduled run`);
      continue;
    }
    // A tick can be delivered twice (or two workers can run); one scheduled batch per window is enough.
    const recent = await db
      .select({ id: testRuns.id })
      .from(testRuns)
      .where(and(eq(testRuns.appId, app.id), eq(testRuns.trigger, "schedule"), gt(testRuns.createdAt, new Date(Date.now() - 2 * 60_000))))
      .limit(1);
    if (recent.length) continue;

    // Drafts haven't passed yet, so they would only raise false alarms.
    const ids = (await db.select({ id: tests.id }).from(tests).where(and(eq(tests.appId, app.id), isNull(tests.draftNote)))).map((t) => t.id);
    const batchId = await queueRuns(db, app.id, ids, "schedule");
    if (!batchId) {
      log.info(`${app.name}: no tests to run`);
      continue;
    }
    await boss.send(QUEUES.tests, { batchId } satisfies TestsJob);
    log.info(`${app.name}: scheduled run ${batchId} (${ids.length} tests)`);
    started.push(batchId);
  }
  return started;
}

async function mayRunUnattended(db: Db, orgId: string, host: string): Promise<boolean> {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (config.dev && LOCAL_HOSTS.has(hostname)) return true;
  const [verified] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.organizationId, orgId), eq(domains.host, hostname), isNotNull(domains.verifiedAt)))
    .limit(1);
  return Boolean(verified);
}
