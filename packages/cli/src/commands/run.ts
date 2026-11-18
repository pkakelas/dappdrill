import { join, resolve } from "node:path";
import { OUTCOME_LABEL, type DrillTarget, type TestResult } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { loadTests, suiteOf, writeJson, writeText, type TestsFile } from "../files.js";
import { renderJunit } from "../junit.js";
import { renderMarkdown } from "../markdown.js";
import { NEEDS_REPAIR, exitCode, reviewLine, summaryText } from "../outcomes.js";
import { buildTarget, type TargetFlags } from "./target.js";
import { commandOn, dim, interruptSignal, pickTests, red, secs, warnSink, yellow } from "./util.js";

export interface RunFlags extends TargetFlags {
  url?: string;
  only?: string;
  junit?: string;
}

/**
 * `dappdrill run`: run the tests in a tests file. Every line is done by code and no model is asked, so
 * it needs no API key. The file is left as it is: a test that needs repairing says so, and
 * `dappdrill repair` writes it. See `exitCode` for what it exits with.
 */
export async function runCommand(file: string, flags: RunFlags): Promise<number> {
  const tests = await loadTests(file);
  return runTests(tests, await buildTarget(flags.url ?? tests.url, flags, "tests", tests), flags, file);
}

/** Runs the file's tests and writes the reports. `path` is where the file is, for saying how to repair it. */
export async function runTests(file: TestsFile, target: DrillTarget, flags: RunFlags, path: string): Promise<number> {
  const picked = pickTests(file, flags.only);

  const out = resolve(flags.out);
  const width = Math.min(60, Math.max(...picked.map((t) => t.name.length)));
  const engine = await loadEngine();

  console.log(`Running ${picked.length} ${picked.length === 1 ? "test" : "tests"} on ${target.url}\n`);
  const signal = interruptSignal();
  const finished: TestResult[] = [];
  let results = finished;
  let stopped = false;
  try {
    const ran = await engine.runSuite({ target, suite: { ...suiteOf(file), tests: picked }, artifactsDir: join(out, "artifacts"), headless: !flags.headed, signal }, warnSink, {
      onTest: (r) => {
        finished.push(r);
        printResult(picked.find((t) => t.id === r.testId)!.name.padEnd(width), r);
      },
    });
    results = ran.tests;
  } catch (e) {
    // Stopped with Ctrl-C: the tests that finished are reported; the rest show as not run.
    if (!signal.aborted) throw e;
    stopped = true;
  }

  const asked = picked.map((t) => t.id);
  await writeJson(join(out, "results.json"), results);
  await writeText(join(out, "summary.md"), renderMarkdown(file, results, asked));
  if (flags.junit) await writeText(flags.junit, renderJunit(file, results));

  const code = exitCode(results, asked.length);
  const summary = summaryText(results, asked.length);
  console.log(`\n${stopped ? "Stopped. " : ""}${code ? red(summary) : summary}. Videos and screenshots: ${join(flags.out, "artifacts")}`);
  if (results.some((r) => r.repairable)) console.log(yellow(`Repair what needs it with: ${commandOn("repair", path)}`));
  return code;
}

export function printResult(name: string, r: TestResult) {
  const took = secs(r.durationMs);
  if (r.outcome === "passed") console.log(`  ✓ ${name}  ${dim(took)}`);
  else if (r.outcome === "failed") console.log(red(`  ✗ ${name}  ${took}`));
  else console.log(yellow(`  ? ${name}  ${OUTCOME_LABEL.unverified.toLowerCase()}`));
  if (r.reason && r.outcome !== "passed") console.log((r.outcome === "failed" ? red : yellow)(`      ${r.reason}`));
  if (r.repairable) console.log(yellow(`      ${NEEDS_REPAIR}`));
  for (const s of r.signingReviews) {
    if (s.verdict !== "consistent") console.log((s.verdict === "dangerous" ? red : yellow)(`      ${reviewLine(s)}`));
  }
}
