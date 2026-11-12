/**
 * Runs a suite file against an app and prints what every line did and how long it took.
 *
 *   pnpm suite <url> <suite.json> [--runs n] [--only text] [--chain id[=rpc]]… [--target file] [--headed]
 *
 * --target is a target.json that `pnpm drill` kept for the app (see dev/target.ts).
 *
 * Results and artifacts go under .drill/suites/<host>/<time>/, one result-<n>.json per run.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { OUTCOME_LABEL, sentence, Suite, type Action, type Check, type LineResult, type SuiteResult } from "@dappdrill/core";
import { runSuite } from "../src/api.js";
import { fromCwd, loadTarget, outDir, secs, usd } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string" }, only: { type: "string" }, chain: { type: "string", multiple: true }, target: { type: "string" }, headed: { type: "boolean" } },
});
const [url, suiteFile] = positionals;
if (!url || !suiteFile) {
  console.error("usage: pnpm suite <url> <suite.json> [--runs n] [--only text] [--chain id[=rpc]]… [--target file] [--headed]");
  process.exit(2);
}

const whole = Suite.parse(JSON.parse(await readFile(fromCwd(suiteFile), "utf8")));
const only = flags.only?.toLowerCase();
const suite: Suite = { ...whole, tests: whole.tests.filter((t) => !only || t.name.toLowerCase().includes(only)) };
if (!suite.tests.length) throw new Error(only ? `No test named like “${flags.only}”.` : "The suite has no tests yet.");

const target = await loadTarget(url, flags);
const out = outDir("suites", url);
await mkdir(out, { recursive: true });

/** A line's sentence, with the run's own values written in. */
const text = (line: Action | Check, values: Record<string, string> = {}) =>
  sentence(line).replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);

function printLine(n: number | string, line: Action | Check, r: LineResult, values?: Record<string, string>): void {
  const who = r.by === "llm" ? (r.model ?? "llm").replace("claude-", "").replace(/-\d.*$/, "") : "code";
  console.log(`  ${String(n).padStart(2)}  ${line.type.padEnd(6)} ${who.padEnd(6)} ${r.status.padEnd(7)} ${secs(r.durationMs)} ${usd(r.costUsd)}  ${text(line, values)}`);
  if (r.redone) console.log(`        recorded actions failed: ${r.redone}`);
  if (r.note) console.log(`        ${r.note}`);
}

const runs: SuiteResult[] = [];
for (let n = 1; n <= Number(flags.runs ?? 1); n++) {
  console.log(`\nRun ${n}`);
  if (suite.setup) console.log("Setup");
  const result = await runSuite({ target, suite, artifactsDir: path.join(out, `run-${n}`), headless: !flags.headed }, undefined, {
    onLine: (testId, i, r) => {
      // A test's lines print with its outcome, so a rerun doesn't print twice.
      if (!testId) printLine(i + 1, suite.setup!.steps[i]!, r);
    },
    onTest: (r) => {
      const test = suite.tests.find((t) => t.id === r.testId)!;
      const inLines = r.steps.reduce((sum, s) => sum + s.durationMs, 0);
      console.log(`\n${test.name}: ${OUTCOME_LABEL[r.outcome]}  ${secs(r.durationMs).trim()}, of which ${secs(inLines).trim()} in its lines  ${usd(r.costUsd).trim()}${r.rerun ? "  (run twice)" : ""}`);
      if (r.reason) console.log(`  ${r.reason}`);
      if (r.firstReason) console.log(`  The first time: ${r.firstReason}`);
      r.steps.forEach((s, i) => printLine(i + 1, test.steps[i]!, s, r.values));
      r.cleanup.forEach((s, i) => printLine(`c${i + 1}`, test.cleanup[i]!, s, r.values));
      for (const review of r.signingReviews) console.log(`  signing review, ${review.verdict}: ${review.title}`);
    },
  });
  runs.push(result);
  await writeFile(path.join(out, `result-${n}.json`), JSON.stringify(result, null, 2));
  console.log(`\nRun ${n}: ${secs(result.durationMs).trim()}, $${result.costUsd.toFixed(4)}, ${result.tests.map((t) => OUTCOME_LABEL[t.outcome]).join(", ")}`);
}

if (runs.length > 1) {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  console.log(`\nOver ${runs.length} runs: median time of each line, and how often it passed`);
  for (const [t, test] of suite.tests.entries()) {
    const results = runs.map((r) => r.tests[t]!);
    console.log(`\n${test.name}: ${results.filter((r) => r.outcome === "passed").length}/${runs.length} passed, median ${secs(median(results.map((r) => r.durationMs))).trim()}`);
    for (const [i, line] of test.steps.entries()) {
      const each = results.flatMap((r) => (r.steps[i] && r.steps[i]!.status !== "skipped" ? [r.steps[i]!] : []));
      if (!each.length) continue;
      const times = each.map((r) => r.durationMs);
      const byModel = each.filter((r) => r.by === "llm").length;
      console.log(`  ${String(i + 1).padStart(2)}  ${line.type.padEnd(6)} ${line.by.padEnd(4)} ${secs(median(times))} (${secs(Math.min(...times)).trim()}–${secs(Math.max(...times)).trim()})  ${each.filter((r) => r.status === "pass").length}/${each.length}${line.by === "code" && byModel ? `, a model did it ${byModel}×` : ""}  ${text(line)}`);
    }
  }
}
console.log(`\n${out}`);
process.exit(0);
