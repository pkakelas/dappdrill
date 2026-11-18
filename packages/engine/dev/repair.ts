/**
 * Writes a suite file's tests as code again: the setup and the reset first, then every test with a line
 * that isn't code yet, or the tests --only names (for one whose recording stopped fitting the page).
 *
 *   pnpm repair <url> <suite.json> [--only text] [--account new|kept] [--key hex] [--fund chainId[:token]:amount]… [--chain id[=rpc]]… [--target file] [--keep-wallet] [--headed] [--dry]
 *
 * A repaired test is one that went the same way twice with no model. It is written back into the suite
 * file, unless --dry. The account flags and --target are told in dev/target.ts.
 *
 * Everything else goes under .drill/repaired/<host>/<time>/: repaired.json and the runs' artifacts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { repairSuite } from "../src/api.js";
import { fromCwd, loadTarget, outDir, printWritten, readSuite, secs, TARGET_FLAGS, TARGET_USAGE } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { ...TARGET_FLAGS, only: { type: "string" }, headed: { type: "boolean" }, dry: { type: "boolean" } },
});
const [url, suiteFile] = positionals;
if (!url || !suiteFile) {
  console.error(`usage: pnpm repair <url> <suite.json> [--only text] ${TARGET_USAGE} [--headed] [--dry]`);
  process.exit(2);
}

const suitePath = fromCwd(suiteFile);
const suite = await readSuite(suitePath);
const only = flags.only?.toLowerCase();
const picked = only ? suite.tests.filter((t) => t.name.toLowerCase().includes(only)) : undefined;
if (picked && !picked.length) throw new Error(`No test named like “${flags.only}”.`);
const target = await loadTarget(url, flags);
const out = outDir("repaired", url);
await mkdir(out, { recursive: true });

const name = (id: string) => suite.tests.find((t) => t.id === id)?.name ?? id;

const t0 = Date.now();
const done = await repairSuite({ target, suite, artifactsDir: out, headless: !flags.headed, testIds: picked?.map((t) => t.id) }, undefined, {
  say: (text) => console.log(`[${secs(Date.now() - t0).trim()}] ${text}`),
});
await writeFile(path.join(out, "repaired.json"), JSON.stringify(done, null, 2));

for (const [what, part] of [["Setup", done.setup], ["Reset", done.reset]] as const) {
  if (!part) continue;
  console.log(`\n${what}, written as code`);
  part.steps.forEach((line, i) => printWritten(i + 1, line));
}
for (const { testId, test, why } of done.tests) {
  console.log(`\n${name(testId)}: ${test ? "repaired" : `not repaired. ${why}`}`);
  test?.steps.forEach((line, i) => printWritten(i + 1, line));
  test?.cleanup.forEach((line, i) => printWritten(`c${i + 1}`, line));
}

const repaired = done.tests.filter((t) => t.test);
console.log(`\n${repaired.length} of ${done.tests.length} repaired${done.setup ? ", and the setup" : ""}${done.reset ? ", and the reset" : ""}.  ${secs(done.durationMs).trim()}, $${done.costUsd.toFixed(2)}`);

if (!flags.dry && (repaired.length || done.setup || done.reset)) {
  // Onto the file as it is now: a look or a make beside this one may have written to it meanwhile.
  const now = await readSuite(suitePath);
  const next = {
    ...now,
    setup: done.setup ?? now.setup,
    reset: done.reset ?? now.reset,
    tests: now.tests.map((t) => repaired.find((r) => r.testId === t.id)?.test ?? t),
  };
  await writeFile(suitePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Written to ${suiteFile}.`);
}
console.log(out);
process.exit(0);
