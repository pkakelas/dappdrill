/**
 * Makes one test from a goal and adds it to a suite file once it is proven.
 *
 *   pnpm make <url> <suite.json> "<goal>" [--start /path] [--chain id[=rpc]]… [--target file] [--headed] [--dry] [--seen "<what looked wrong>"]
 *
 * The suite file gives the setup and what is known about the app (its notes); it is made when it
 * isn't there. A proven test and what was learned on the way are written back into it, unless
 * --dry. --target is a target.json kept for the app (see dev/target.ts).
 * With --seen the goal is to find out about something that looked wrong: its test is only added
 * when it fails every time.
 *
 * Everything else goes under .drill/made/<host>/<time>/: made.json and the runs' artifacts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { OUTCOME_LABEL, sentence, Suite, type Test, type TestResult } from "@dappdrill/core";
import { makeTest } from "../src/api.js";
import { fromCwd, loadTarget, outDir, secs, usd } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { start: { type: "string" }, chain: { type: "string", multiple: true }, target: { type: "string" }, headed: { type: "boolean" }, dry: { type: "boolean" }, seen: { type: "string" } },
});
const [url, suiteFile, goal] = positionals;
if (!url || !suiteFile || !goal) {
  console.error('usage: pnpm make <url> <suite.json> "<goal>" [--start /path] [--chain id[=rpc]]… [--target file] [--headed] [--dry] [--seen "<what looked wrong>"]');
  process.exit(2);
}

const suitePath = fromCwd(suiteFile);
const suite = Suite.parse(JSON.parse(await readFile(suitePath, "utf8").catch(() => "{}")));
const target = await loadTarget(url, flags);
const out = outDir("made", url);
await mkdir(out, { recursive: true });

const t0 = Date.now();
const suspicion = flags.seen ? { what: flags.seen, expected: goal, saw: flags.seen } : undefined;
const made = await makeTest({ target, suite, goal, startPath: flags.start, suspicion, artifactsDir: out, headless: !flags.headed }, undefined, (text) => console.log(`[${secs(Date.now() - t0).trim()}] ${text}`));
await writeFile(path.join(out, "made.json"), JSON.stringify(made, null, 2));

function printTest(test: Test, last?: TestResult): void {
  console.log(`\n${test.name}  (starts on ${test.startPath})`);
  for (const [name, v] of Object.entries(test.values)) console.log(`  {{${name}}}: ${v.from} to ${v.to}`);
  for (const [i, line] of test.steps.entries()) {
    const r = last?.steps[i];
    const how = r ? `${r.status.padEnd(7)} ${secs(r.durationMs)} ${usd(r.costUsd)}` : "";
    console.log(`  ${String(i + 1).padStart(2)}  ${line.type.padEnd(6)} ${line.by.padEnd(4)} ${how}  ${sentence(line)}`);
    if (line.type === "check" && line.by === "code") console.log(`        ${JSON.stringify(line.expect)}`);
    if (line.type === "action" && line.by === "code") console.log(`        ${line.run.length ? `${line.run.length} recorded` : "not recorded"}`);
    if (r?.note && r.status !== "pass") console.log(`        ${r.note}`);
  }
  for (const c of test.cleanup) console.log(`   c  action llm   ${c.do}`);
}

if (made.test) printTest(made.test, made.runs.at(-1));
console.log(`\nRuns: ${made.runs.map((r) => `${OUTCOME_LABEL[r.outcome]} ${secs(r.durationMs).trim()} ${usd(r.costUsd).trim() || "$0"}`).join(" | ") || "none"}`);
if (made.repairs.length) console.log(`\nRepairs:\n${made.repairs.map((r) => `- ${r}`).join("\n")}`);
if (made.findings.length) console.log(`\nFindings:\n${made.findings.map((f) => `- ${f.proven ? "" : "(seen, and no test fails on it) "}${f.what}\n    expected: ${f.expected}\n    saw: ${f.saw}`).join("\n")}`);
if (made.notes.length) console.log(`\nNotes:\n${made.notes.map((n) => `- ${n}`).join("\n")}`);

const verdict = made.proven ? `Proven: ${made.stands === "passed" ? "passes" : "fails on a fault of the app"} the same way twice in a row.` : `Not proven: ${made.why}`;
console.log(`\n${verdict}  ${secs(made.durationMs).trim()}, $${made.costUsd.toFixed(2)} (the draft $${made.draftUsd.toFixed(2)})`);

if (made.proven && made.test && suspicion && made.stands === "passed") console.log(`Not added: ${made.dismissed.at(-1) ?? "the app did it right, so there is nothing to keep."}`);
else if (made.proven && made.test && !flags.dry) {
  const known = new Set(suite.notes.map((n) => n.text));
  const notes = [...suite.notes, ...made.notes.filter((n) => !known.has(n)).map((text) => ({ text, from: "maker" as const }))];
  await writeFile(suitePath, `${JSON.stringify({ ...suite, notes, tests: [...suite.tests, made.test] }, null, 2)}\n`);
  console.log(`Added to ${suiteFile}.`);
}
console.log(out);
process.exit(0);
