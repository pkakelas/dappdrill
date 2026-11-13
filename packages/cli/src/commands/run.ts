import { join, resolve } from "node:path";
import { OUTCOME_LABEL, setupWithRecordings, withRecordings, type DrillTarget, type LineResult, type TestResult } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { UsageError, loadTests, suiteOf, writeJson, writeText, type TestsFile } from "../files.js";
import { renderJunit } from "../junit.js";
import { renderMarkdown } from "../markdown.js";
import { exitCode, reviewLine, summaryText } from "../outcomes.js";
import { buildTarget, dim, red, warnSink, yellow, type TargetFlags } from "./target.js";
import { interruptSignal } from "./util.js";

export interface RunFlags extends TargetFlags {
  url?: string;
  only?: string;
  junit?: string;
}

/** `dappdrill run`: run the tests in a tests file. See `exitCode` for what it exits with. */
export async function runCommand(file: string, flags: RunFlags): Promise<number> {
  const tests = await loadTests(file);
  const before = structuredClone(tests);
  const target = await buildTarget(flags.url ?? tests.url, flags, "run", tests);
  const code = await runTests(tests, target, flags);
  // Lines carry the browser actions that worked; saving them keeps the next run fast. The file is read
  // again first, so what was written to it meanwhile (a make, a hand edit) stays.
  try {
    await writeJson(file, learned(await loadTests(file), before, tests));
  } catch (e) {
    console.log(yellow(`  What this run recorded wasn't saved: ${(e as Error).message}`));
  }
  return code;
}

/** `now` with what the run recorded, for the setup and each test still as it was when the run began. */
function learned(now: TestsFile, before: TestsFile, after: TestsFile): TestsFile {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const ran = (id: string) => [before.tests.find((t) => t.id === id), after.tests.find((t) => t.id === id)] as const;
  return {
    ...now,
    setup: same(now.setup, before.setup) ? after.setup : now.setup,
    tests: now.tests.map((t) => {
      const [was, is] = ran(t.id);
      return was && is && same(t, was) ? is : t;
    }),
  };
}

/** Runs the file's tests and writes the reports. What a model had to work out is written into `file`'s lines. */
export async function runTests(file: TestsFile, target: DrillTarget, flags: RunFlags): Promise<number> {
  const only = flags.only?.toLowerCase();
  const picked = file.tests.filter((t) => !only || t.name.toLowerCase().includes(only));
  if (picked.length === 0) throw new UsageError(flags.only ? `No test matches "${flags.only}".` : "There are no tests in the file. Make some with: dappdrill make <url>");

  const out = resolve(flags.out);
  const width = Math.min(60, Math.max(...picked.map((t) => t.name.length)));
  const setup: LineResult[] = [];
  const engine = await loadEngine();

  console.log(`Running ${picked.length} ${picked.length === 1 ? "test" : "tests"} on ${target.url}\n`);
  const signal = interruptSignal();
  const finished: TestResult[] = [];
  let results = finished;
  let stopped = false;
  try {
    const ran = await engine.runSuite({ target, suite: { ...suiteOf(file), tests: picked }, artifactsDir: join(out, "artifacts"), headless: !flags.headed, signal }, warnSink, {
      onLine: (testId, i, line) => {
        if (!testId) setup[i] = line;
      },
      onTest: (r) => {
        finished.push(r);
        printResult(picked.find((t) => t.id === r.testId)!.name.padEnd(width), r);
      },
    });
    results = ran.tests;
  } catch (e) {
    // Stopped with Ctrl-C: the tests that finished are reported and keep what they recorded; the rest show as not run.
    if (!signal.aborted) throw e;
    stopped = true;
  }

  // What this run learned: the actions a model took where nothing was recorded, or where the recording stopped working.
  if (file.setup && setup.length === file.setup.steps.length) file.setup = setupWithRecordings(file.setup, setup);
  file.tests = file.tests.map((t) => {
    const r = results.find((x) => x.testId === t.id);
    return r ? withRecordings(t, r) : t;
  });

  const asked = picked.map((t) => t.id);
  await writeJson(join(out, "results.json"), results);
  await writeText(join(out, "summary.md"), renderMarkdown(file, results, asked));
  if (flags.junit) await writeText(flags.junit, renderJunit(file, results));

  const code = exitCode(results, asked.length);
  const summary = summaryText(results, asked.length);
  console.log(`\n${stopped ? "Stopped. " : ""}${code ? red(summary) : summary}. Videos and screenshots: ${join(flags.out, "artifacts")}`);
  return code;
}

export function printResult(name: string, r: TestResult) {
  const secs = `${Math.round(r.durationMs / 1000)}s`;
  if (r.outcome === "passed") console.log(`  ✓ ${name}  ${dim(secs)}`);
  else if (r.outcome === "failed") console.log(red(`  ✗ ${name}  ${secs}`));
  else console.log(yellow(`  ? ${name}  ${OUTCOME_LABEL.unverified.toLowerCase()}`));
  if (r.reason && r.outcome !== "passed") console.log((r.outcome === "failed" ? red : yellow)(`      ${r.reason}`));
  for (const s of r.signingReviews) {
    if (s.verdict !== "consistent") console.log((s.verdict === "dangerous" ? red : yellow)(`      ${reviewLine(s)}`));
  }
}
