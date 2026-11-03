/** Aborts on the first Ctrl-C so the engine can stop and we still write a partial report; the second one quits. */
export function interruptSignal(): AbortSignal {
  const controller = new AbortController();
  process.on("SIGINT", () => {
    if (controller.signal.aborted) process.exit(130);
    console.error("\nStopping… (Ctrl-C again to quit now)");
    controller.abort();
  });
  return controller.signal;
}
