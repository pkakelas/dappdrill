import { config } from "../config.js";
import { errorMessage, type Logger } from "../log.js";

/**
 * Stopping is a flag the web sets on a row; this polls it. `check` returns the
 * ids to stop now (a single job checks its own id).
 */
export function pollStops(check: () => Promise<string[]>, onStop: (id: string) => void, log: Logger): () => void {
  const timer = setInterval(async () => {
    try {
      for (const id of await check()) onStop(id);
    } catch (e) {
      log.warn(`stop poll failed: ${errorMessage(e)}`);
    }
  }, config.stopPollMs);
  return () => clearInterval(timer);
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
