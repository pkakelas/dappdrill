import { eq } from "drizzle-orm";
import { makes, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { errorMessage, type Logger } from "../log.js";

/**
 * Stopping is a flag the web sets on a row. This asks for it every so often and aborts `signal` once
 * it is set. `end` stops asking.
 */
export function stopSignal(asked: () => Promise<boolean>, log: Logger): { signal: AbortSignal; end(): void } {
  const stop = new AbortController();
  const timer = setInterval(async () => {
    try {
      if (await asked()) stop.abort();
    } catch (e) {
      log.warn(`stop poll failed: ${errorMessage(e)}`);
    }
  }, config.stopPollMs);
  return { signal: stop.signal, end: () => clearInterval(timer) };
}

/** Whether somebody asked to stop this make or repair. */
export async function makeStopAsked(db: Db, makeId: string): Promise<boolean> {
  const [row] = await db.select({ stop: makes.stopRequested }).from(makes).where(eq(makes.id, makeId));
  return row?.stop ?? false;
}

/** Calls `fn` at most once per `ms`, always with the latest value; the last call is never dropped. */
export function throttle<T>(ms: number, fn: (value: T) => Promise<unknown>): { push(value: T): void; flush(): Promise<void> } {
  let last = 0;
  let pending: T | undefined;
  let timer: NodeJS.Timeout | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  const fire = () => {
    timer = undefined;
    last = Date.now();
    const value = pending as T;
    pending = undefined;
    chain = chain.then(() => fn(value)).catch(() => {});
  };
  return {
    push(value) {
      pending = value;
      if (timer) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        fire();
      }
      await chain;
    },
  };
}
