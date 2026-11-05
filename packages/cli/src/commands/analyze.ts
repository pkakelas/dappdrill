import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { blockedLine, newId, SETUP_WHEN_LABEL, stalledLine } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { UsageError, writeJson, type TestsFile } from "../files.js";
import { addUnhappyPaths, runTests, type RunFlags } from "./run.js";
import { buildTarget, logSink, red } from "./target.js";
import { interruptSignal } from "./util.js";

export interface AnalyzeFlags extends RunFlags {
  file: string;
  hints?: string;
  maxMinutes?: string;
  force?: boolean;
  run: boolean;
}

/** `dappdrill analyze <url>`: find the app's main flows, write a test for each, then run them. */
export async function analyzeCommand(url: string, flags: AnalyzeFlags): Promise<number> {
  if (existsSync(flags.file) && !flags.force) throw new UsageError(`${flags.file} already exists. Run it with: dappdrill run. To start over, pass --force.`);
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
  const problem = found.blocked
    ? blockedLine(found.blocked)
    : found.stalled
      ? stalledLine(found.stalled)
      : found.flows.length === 0 && "No flows found. Say where things are with --hints.";
  if (problem) {
    console.log(red(`\n${problem}`));
    return 2;
  }

  const tests: TestsFile = {
    url: target.url,
    map: found.map,
    chains: found.chains,
    setup: found.setup && { startPath: found.setup.startPath || "/", steps: found.setup.steps.map((text) => ({ text })), when: found.setup.when, why: found.setup.why },
    flows: found.flows.flatMap((f) => (f.test ? [{ name: f.name, goal: f.goal, tests: [{ id: newId("test"), ...f.test, steps: f.test.steps.map((text) => ({ text })) }] }] : [])),
  };
  if (flags.unhappy) addUnhappyPaths(tests);
  await writeJson(flags.file, tests);
  console.log(`\nFound ${tests.flows.map((f) => f.name).join(", ")}. Tests: ${flags.file}\n`);
  const untested = found.flows.filter((f) => !f.test);
  if (untested.length) console.log(`Seen but not tested: ${untested.map((f) => f.name).join(", ")}\n`);
  if (tests.setup) console.log(`Setup (${SETUP_WHEN_LABEL[tests.setup.when].toLowerCase()}): ${tests.setup.steps.map((s) => s.text).join(" → ")}\n`);
  if (!flags.run) return 0;

  const code = await runTests(tests, { ...target, learnedChains: found.chains }, flags);
  await writeJson(flags.file, tests);
  return code;
}
