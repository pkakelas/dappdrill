import type { DrillEventSink, Test } from "@dappdrill/core";
import { TESTS_FILE, UsageError, type TestsFile } from "../files.js";

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

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
/** Only problems get colour. */
export const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
export const yellow = (s: string) => (useColour ? `\x1b[33m${s}\x1b[0m` : s);
export const dim = (s: string) => (useColour ? `\x1b[2m${s}\x1b[0m` : s);

/** The engine's warnings; frames, wallet chatter and its own progress notes are left out. */
export const warnSink: DrillEventSink = (event) => {
  if (event.type === "log" && event.level !== "info") console.log((event.level === "error" ? red : yellow)(`  ${event.message}`));
};

export const secs = (ms: number) => `${Math.round(ms / 1000)}s`;

/** The command to type for the tests file at `path`: the file is named only when it isn't the usual one. */
export const commandOn = (verb: "run" | "repair", path: string) => `dappdrill ${verb}${path === TESTS_FILE ? "" : ` ${path}`}`;

/** The file's tests, or with --only those whose name holds the text. A file with no tests, or none that match, is a usage error. */
export function pickTests(file: TestsFile, only?: string): Test[] {
  if (file.tests.length === 0) throw new UsageError("There are no tests in the file. Make some with: dappdrill make <url>");
  if (!only) return file.tests;
  const picked = file.tests.filter((t) => t.name.toLowerCase().includes(only.toLowerCase()));
  if (picked.length === 0) throw new UsageError(`No test matches "${only}".`);
  return picked;
}
