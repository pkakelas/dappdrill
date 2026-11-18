import { tryAppLock, type AppLock, type Db } from "@dappdrill/db";
import type { PgBoss } from "pg-boss";
import type { Logger } from "../log.js";

/** How long a job waits before it looks again when another holds the app. */
const BUSY_RETRY_SECONDS = 30;

/**
 * The app's lock, for a job that must be the only one on the app. When another job holds it, this one
 * is sent again to look later and nothing is returned: its rows stay queued.
 */
export async function appTurn(db: Db, boss: PgBoss, appId: string, queue: string, job: object, log: Logger): Promise<AppLock | undefined> {
  const lock = await tryAppLock(db, appId);
  if (lock) return lock;
  log.info(`another job is on this app; looking again in ${BUSY_RETRY_SECONDS}s`);
  await boss.send(queue, job, { startAfter: BUSY_RETRY_SECONDS });
  return undefined;
}
