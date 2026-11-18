/**
 * From a URL to a suite of proven tests, the way a user gets them: look for goals, make a test for
 * each, most important first, then one for each thing that looked wrong on the way (kept only when
 * it fails every time), then run them all once.
 *
 *   pnpm tests <url> <suite.json> [--count n] [--together n] [--account new|kept] [--key hex] [--fund chainId[:token]:amount]… [--chain id[=rpc]]… [--target file] [--keep-wallet] [--headed]
 *
 * Three tests are made at a time on new accounts (--together changes that), and one at a time on a
 * kept account, which the tests share.
 *
 * The suite file is made when it isn't there, with a setup that connects the wallet. It is written
 * after the look and after every proven test, so a run that is stopped keeps what it had.
 * The account flags and --target are told in dev/target.ts.
 *
 * Everything else goes under .drill/tests/<host>/<time>/: the look, each make and the run.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { OUTCOME_LABEL, type Suite } from "@dappdrill/core";
import { makeTests, runSuite } from "../src/api.js";
import { MAX_GOALS } from "../src/make/look.js";
import { addToSuite, fromCwd, loadTarget, outDir, readSuite, secs, TARGET_FLAGS, TARGET_USAGE } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { ...TARGET_FLAGS, count: { type: "string" }, together: { type: "string" }, headed: { type: "boolean" } },
});
const [url, suiteFile] = positionals;
if (!url || !suiteFile) {
  console.error(`usage: pnpm tests <url> <suite.json> [--count n] [--together n] ${TARGET_USAGE} [--headed]`);
  process.exit(2);
}
const count = Number(flags.count ?? MAX_GOALS);

/** What a new suite starts with: a user whose wallet is connected. */
const CONNECTED = {
  startPath: "/",
  steps: [{ type: "action", by: "llm", do: "Connect the wallet to the app (it is listed as MetaMask) and close any first-visit prompt in the way. If the app shows the wallet as connected already, do nothing." }],
};

const suitePath = fromCwd(suiteFile);
let suite = await readSuite(suitePath, { setup: CONNECTED });
let writing = Promise.resolve();
/** What the suite gained since the last write, onto the file as it is now; one write at a time, as the makes side by side each add theirs. */
const save = (next: Suite) => {
  const notes = next.notes.filter((n) => !suite.notes.some((w) => w.text === n.text));
  const tests = next.tests.filter((t) => !suite.tests.some((w) => w.id === t.id));
  suite = next;
  return (writing = writing.catch(() => {}).then(async () => void (await addToSuite(suitePath, { setup: CONNECTED }, { notes, tests }))));
};
const target = await loadTarget(url, flags);
const out = outDir("tests", url);
await mkdir(out, { recursive: true });
const headless = !flags.headed;
const t0 = Date.now();
const at = () => `[${secs(Date.now() - t0).trim()}]`;

const made = await makeTests({ target, suite, count, together: flags.together ? Number(flags.together) : undefined, artifactsDir: out, headless }, undefined, {
  say: (text, n) => console.log(`${at()} ${n ? `(${n}) ` : ""}${text}`),
  onLooked: (looked) => {
    if (looked.summary) console.log(`\n${looked.summary}`);
    if (!looked.goals.length) return console.log(`\nNo goals: ${looked.why}`);
    const goals = looked.goals.slice(0, count);
    console.log(`\nGoals (${secs(looked.durationMs).trim()}, $${looked.costUsd.toFixed(2)}):\n${goals.map((g, i) => `${String(i + 1).padStart(2)}  ${g.goal}\n      ${g.startPath}  (${g.why})`).join("\n")}`);
    if (looked.notes.length) console.log(`\nNotes:\n${looked.notes.map((n) => `- ${n}`).join("\n")}`);
    if (looked.problems.length) console.log(`\nLooked wrong, and gets a test to find out:\n${looked.problems.map((f) => `- ${f.what}: ${f.saw}`).join("\n")}`);
  },
  onGoal: (goal, n, suspicion) => console.log(`\n${at()} Making ${n}${suspicion ? `, to find out about “${suspicion.what}”` : ""}: ${goal}`),
  onAttempt: (a, n) => {
    if (a.made) void writeFile(path.join(out, `made-${n}.json`), JSON.stringify(a.made, null, 2));
    const spent = a.made ? `  ${secs(a.made.durationMs).trim()}, $${a.made.costUsd.toFixed(2)}` : "";
    if (!a.kept || !a.made?.test) return console.log(`  (${n}) Not kept: ${a.why}${spent}`);
    console.log(`  (${n}) ${a.made.test.name}: ${a.made.test.steps.length} lines, ${a.made.stands === "passed" ? "passes" : "fails on a fault of the app"} twice in a row, ${a.made.runs.length} runs, ${a.made.repairs.length} repairs${spent}`);
  },
  onSuite: save,
});
await writeFile(path.join(out, "looked.json"), JSON.stringify(made.looked, null, 2));
if (made.stopped) console.log(`\n${made.stopped} The goals left weren't tried.`);
if (!made.looked.goals.length) process.exit(1);

if (suite.tests.length) {
  console.log(`\n${at()} Running the ${suite.tests.length} tests`);
  const result = await runSuite({ target, suite, artifactsDir: path.join(out, "run"), headless }, undefined, {
    onTest: (r) => {
      const test = suite.tests.find((t) => t.id === r.testId)!;
      console.log(`  ${OUTCOME_LABEL[r.outcome].padEnd(15)} ${secs(r.durationMs)}  ${test.name}${r.rerun ? "  (run twice)" : ""}${r.reason ? `\n      ${r.reason}` : ""}`);
    },
  });
  await writeFile(path.join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(`  The run: ${secs(result.durationMs).trim()}`);
}

const faults = made.attempts.flatMap((a) => (a.kept ? (a.made?.findings ?? []).filter((f) => f.proven) : []));
if (faults.length) console.log(`\nFaults a test fails on:\n${faults.map((f) => `- ${f.what}\n    expected: ${f.expected}\n    saw: ${f.saw}`).join("\n")}`);
const unmade = made.attempts.filter((a) => !a.kept);
if (unmade.length) console.log(`\nNo test for:\n${unmade.map((a) => `- ${a.goal}\n      ${a.why}`).join("\n")}`);
console.log(`\n${suite.tests.length} tests in ${suiteFile}, from ${made.attempts.length} goals. ${secs(Date.now() - t0).trim()}, $${made.costUsd.toFixed(2)}`);
console.log(out);
process.exit(0);
