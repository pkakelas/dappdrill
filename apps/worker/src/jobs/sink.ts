import type { DrillEvent, DrillEventSink } from "@dappdrill/core";
import { errorMessage, type Logger } from "../log.js";

/**
 * Handles events one at a time, in order, whether or not the engine awaits the sink.
 * A failed write is logged and skipped so one bad event can't kill a scan.
 */
export function serialSink(handle: (event: DrillEvent) => Promise<void>, log: Logger): { sink: DrillEventSink; drain(): Promise<void> } {
  let chain: Promise<void> = Promise.resolve();
  return {
    sink(event) {
      chain = chain.then(() => handle(event)).catch((e) => log.error(`could not store ${event.type} event: ${errorMessage(e)}`));
      return chain;
    },
    drain: () => chain,
  };
}

/** Logs the engine's own log lines (used where events aren't stored). */
export function logEvents(log: Logger): DrillEventSink {
  return (event) => {
    if (event.type === "log") log[event.level](event.message);
  };
}
