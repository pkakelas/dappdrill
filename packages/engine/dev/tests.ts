/**
 * From a URL to a suite of proven tests, the way a user gets them: look for goals, make a test for
 * each, most important first, then run them all once.
 *
 *   pnpm tests <url> <suite.json> [--count n] [--chain id[=rpc]]… [--target file] [--headed]
 *
 * The suite file is made when it isn't there, with a setup that connects the wallet. It is written
 * after the look and after every proven test, so a run that is stopped keeps what it had.
 * --target is a target.json that `pnpm drill` kept for the app (see dev/target.ts).
 *
 * Everything else goes under .drill/tests/<host>/<time>/: the look, each make and the run.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { OUTCOME_LABEL, Suite } from "@dappdrill/core";
import { lookForGoals, makeTest, runSuite, type Made } from "../src/api.js";
import { fromCwd, loadTarget, outDir, secs } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { count: { type: "string" }, chain: { type: "string", multiple: true }, target: { type: "string" }, headed: { type: "boolean" } },
});
const [url, suiteFile] = positionals;
if (!url || !suiteFile) {
  console.error("usage: pnpm tests <url> <suite.json> [--count n] [--chain id[=rpc]]… [--target file] [--headed]");
  process.exit(2);
}
const count = Number(flags.count ?? 10);

/** What a new suite starts with: a user whose wallet is connected. */
const CONNECTED = {
  startPath: "/",
  steps: [{ type: "action", by: "llm", do: "Connect the wallet to the app (it is listed as MetaMask) and close any first-visit prompt in the way. If the app shows the wallet as connected already, do nothing." }],
};

const suitePath = fromCwd(suiteFile);
const kept = await readFile(suitePath, "utf8").catch(() => undefined);
let suite = Suite.parse(kept ? JSON.parse(kept) : { setup: CONNECTED });
const save = async () => {
  await mkdir(path.dirname(suitePath), { recursive: true });
  await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`);
};
const target = await loadTarget(url, flags);
const out = outDir("tests", url);
await mkdir(out, { recursive: true });
const headless = !flags.headed;
const t0 = Date.now();
const at = () => `[${secs(Date.now() - t0).trim()}]`;
let costUsd = 0;

const looked = await lookForGoals({ target, suite, artifactsDir: path.join(out, "look"), headless }, undefined, (text) => console.log(`${at()} ${text}`));
costUsd += looked.costUsd;
await writeFile(path.join(out, "looked.json"), JSON.stringify(looked, null, 2));
if (looked.summary) console.log(`\n${looked.summary}`);
if (!looked.goals.length) {
  console.log(`\nNo goals: ${looked.why}`);
  process.exit(1);
}
const goals = looked.goals.slice(0, count);
console.log(`\nGoals (${secs(looked.durationMs).trim()}, $${looked.costUsd.toFixed(2)}):\n${goals.map((g, i) => `${String(i + 1).padStart(2)}  ${g.goal}\n      ${g.startPath}  (${g.why})`).join("\n")}`);
if (looked.notes.length) console.log(`\nNotes:\n${looked.notes.map((n) => `- ${n}`).join("\n")}`);
suite = { ...suite, notes: [...suite.notes, ...looked.notes.map((text) => ({ text, from: "look" as const }))] };
await save();

const findings: Made["findings"] = [];
const unmade: string[] = [];
for (const [i, g] of goals.entries()) {
  console.log(`\n${at()} Making ${i + 1} of ${goals.length}: ${g.goal}`);
  try {
    const made = await makeTest({ target, suite, goal: g.goal, startPath: g.startPath, artifactsDir: path.join(out, `make-${i + 1}`), headless });
    costUsd += made.costUsd;
    await writeFile(path.join(out, `made-${i + 1}.json`), JSON.stringify(made, null, 2));
    findings.push(...made.findings);
    if (!made.proven || !made.test) {
      unmade.push(`${g.goal}\n      ${made.why}`);
      console.log(`  Not proven: ${made.why}  ${secs(made.durationMs).trim()}, $${made.costUsd.toFixed(2)}`);
      continue;
    }
    const known = new Set(suite.notes.map((n) => n.text));
    suite = { ...suite, notes: [...suite.notes, ...made.notes.filter((n) => !known.has(n)).map((text) => ({ text, from: "maker" as const }))], tests: [...suite.tests, made.test] };
    await save();
    console.log(`  ${made.test.name}: ${made.test.steps.length} lines, ${made.stands === "passed" ? "passes" : "fails on a fault of the app"} twice in a row, ${made.runs.length} runs, ${made.repairs.length} repairs  ${secs(made.durationMs).trim()}, $${made.costUsd.toFixed(2)}`);
  } catch (e) {
    unmade.push(`${g.goal}\n      It broke on our side: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  It broke on our side: ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (suite.tests.length) {
  console.log(`\n${at()} Running the ${suite.tests.length} tests`);
  const result = await runSuite({ target, suite, artifactsDir: path.join(out, "run"), headless }, undefined, {
    onTest: (r) => {
      const test = suite.tests.find((t) => t.id === r.testId)!;
      console.log(`  ${OUTCOME_LABEL[r.outcome].padEnd(15)} ${secs(r.durationMs)}  ${test.name}${r.rerun ? "  (run twice)" : ""}${r.reason ? `\n      ${r.reason}` : ""}`);
    },
  });
  costUsd += result.costUsd;
  await writeFile(path.join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(`  The run: ${secs(result.durationMs).trim()}, $${result.costUsd.toFixed(4)}`);
}

if (findings.length) console.log(`\nFindings:\n${findings.map((f) => `- ${f.proven ? "" : "(seen, and no test fails on it) "}${f.what}\n    expected: ${f.expected}\n    saw: ${f.saw}`).join("\n")}`);
if (unmade.length) console.log(`\nNo test for:\n${unmade.map((u) => `- ${u}`).join("\n")}`);
console.log(`\n${suite.tests.length} tests in ${suiteFile}, from ${goals.length} goals. ${secs(Date.now() - t0).trim()}, $${costUsd.toFixed(2)}`);
console.log(out);
process.exit(0);
