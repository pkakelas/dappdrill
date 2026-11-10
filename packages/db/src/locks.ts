/**
 * One job at a time on an app's live chain. A fork is a copy per run, but a live account is one
 * account: two runs on it at once would cancel each other's orders and read each other's balances.
 * The lock is a Postgres session lock held on one reserved connection, so it goes with the worker
 * that holds it when that worker dies.
 */
import type { Db } from "./client.js";

export interface AppLock {
  release(): Promise<void>;
}

/** The lock on `appId` when it is free, otherwise undefined. */
export async function tryAppLock(db: Db, appId: string): Promise<AppLock | undefined> {
  const conn = await db.$client.reserve();
  const key = `app:${appId}`;
  try {
    const [row] = await conn.unsafe<{ locked: boolean }[]>("select pg_try_advisory_lock(hashtext($1)) as locked", [key]);
    if (!row?.locked) {
      conn.release();
      return undefined;
    }
  } catch (e) {
    conn.release();
    throw e;
  }
  return {
    async release() {
      try {
        await conn.unsafe("select pg_advisory_unlock(hashtext($1))", [key]);
      } finally {
        conn.release();
      }
    },
  };
}
