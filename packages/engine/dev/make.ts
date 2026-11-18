/**
 * Makes one test from a goal and adds it to a suite file once it is proven.
 *
 *   pnpm make <url> <suite.json> "<goal>" [--start /path] [--account new|kept] [--key hex] [--fund chainId[:token]:amount]… [--chain id[=rpc]]… [--target file] [--keep-wallet] [--headed] [--dry] [--seen "<what looked wrong>"]
 *
 * The suite file gives the setup and what is known about the app (its notes); it is made when it
 * isn't there. A proven test and what was learned on the way are written back into it, unless
 * --dry. The account flags and --target are told in dev/target.ts.
 * With --seen the goal is to find out about something that looked wrong: its test is only added
 * when it fails every time.
 *
 * Everything else goes under .drill/made/<host>/<time>/: made.json and the runs' artifacts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { OUTCOME_LABEL, type Test, type TestResult } from "@dappdrill/core";
import { makeTest } from "../src/api.js";
import { addToSuite, fromCwd, loadTarget, outDir, printWritten, readSuite, secs, TARGET_FLAGS, TARGET_USAGE, usd } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { ...TARGET_FLAGS, start: { type: "string" }, headed: { type: "boolean" }, dry: { type: "boolean" }, seen: { type: "string" } },
});
const [url, suiteFile, goal] = positionals;
if (!url || !suiteFile || !goal) {
  console.error(`usage: pnpm make <url> <suite.json> "<goal>" [--start /path] ${TARGET_USAGE} [--headed] [--dry] [--seen "<what looked wrong>"]`);
  process.exit(2);
}

const suitePath = fromCwd(suiteFile);
const suite = await readSuite(suitePath);
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
    printWritten(i + 1, line, r && `${r.status.padEnd(7)} ${secs(r.durationMs)} ${usd(r.costUsd)}`);
    if (r?.note && r.status !== "pass") console.log(`        ${r.note}`);
  }
  test.cleanup.forEach((line, i) => printWritten(`c${i + 1}`, line));
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
  // Onto the file as it is now: a look or a make beside this one may have written to it meanwhile.
  await addToSuite(suitePath, suite, { notes: made.notes.map((text) => ({ text, from: "maker" as const })), tests: [made.test] });
  console.log(`Added to ${suiteFile}.`);
}
console.log(out);
process.exit(0);
