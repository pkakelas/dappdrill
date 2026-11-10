import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { blockedLine, newId, SETUP_WHEN_LABEL, stalledLine } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { UsageError, pickConditions, writeJson, type TestsFile } from "../files.js";
import { runTests, type RunFlags } from "./run.js";
import { buildTarget, logSink, red } from "./target.js";
import { interruptSignal } from "./util.js";

export interface AnalyzeFlags extends RunFlags {
  file: string;
  hints?: string;
  maxMinutes?: string;
  force?: boolean;
  run: boolean;
}

/** `dappdrill analyze <url>`: find what users do in the app, write tests for the main things, then run them. */
export async function analyzeCommand(url: string, flags: AnalyzeFlags): Promise<number> {
  if (existsSync(flags.file) && !flags.force) throw new UsageError(`${flags.file} already exists. Run it with: dappdrill run. To start over, pass --force.`);
  if (pickConditions(flags).length > 0 && !flags.run) throw new UsageError("Unhappy paths are added once a run reaches the wallet, so they can't be used with --no-run.");
  const target = await buildTarget(url, flags);
  const maxMinutes = flags.maxMinutes ? Number(flags.maxMinutes) : undefined;
  if (maxMinutes !== undefined && !(maxMinutes > 0)) throw new UsageError("--max-minutes must be a positive number.");

  console.log(`Looking around ${target.url}`);
  const engine = await loadEngine();
  const found = await engine.analyze(
    target,
    { artifactsDir: join(resolve(flags.out), "artifacts"), hints: flags.hints, maxMs: maxMinutes && maxMinutes * 60_000, headless: !flags.headed },
    logSink,
    interruptSignal(),
  );
  await writeJson(join(resolve(flags.out), "analysis.json"), found);
  const problem = found.blocked
    ? blockedLine(found.blocked)
    : found.stalled
      ? stalledLine(found.stalled)
      : found.tests.length === 0 && "No tests found. Say where things are with --hints.";
  if (problem) {
    console.log(red(`\n${problem}`));
    return 2;
  }

  const tests: TestsFile = {
    url: target.url,
    map: found.map,
    chains: found.chains,
    setup: found.setup && {
      startPath: found.setup.startPath || "/",
      steps: found.setup.steps.map((text) => ({ text })),
      when: found.setup.when,
      why: found.setup.why,
      ...(found.setup.reset?.length ? { reset: found.setup.reset.map((text) => ({ text })) } : {}),
    },
    tests: found.tests.map((t) => ({ id: newId("test"), ...t, steps: t.steps.map((text) => ({ text })), after: t.after?.map((text) => ({ text })) })),
  };
  await writeJson(flags.file, tests);
  console.log(`\nFound ${found.tests.map((t) => t.name).join(", ")}. Tests: ${flags.file}\n`);
  if (found.untested.length) console.log(`Seen but not tested: ${found.untested.map((t) => t.name).join(", ")}\n`);
  if (tests.setup) console.log(`Setup (${SETUP_WHEN_LABEL[tests.setup.when].toLowerCase()}): ${tests.setup.steps.map((s) => s.text).join(" → ")}\n`);
  if (!flags.run) return 0;

  const code = await runTests(tests, { ...target, learnedChains: found.chains }, flags);
  await writeJson(flags.file, tests);
  return code;
}
