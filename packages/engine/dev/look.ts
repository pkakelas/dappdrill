/**
 * Looks around an app and lists the goals worth a test.
 *
 *   pnpm look <url> <suite.json> [--account new|kept] [--key hex] [--fund chainId[:token]:amount]… [--chain id[=rpc]]… [--target file] [--keep-wallet] [--headed] [--dry]
 *
 * The suite file gives the setup, what is known about the app and the tests it already has; it
 * needn't be there yet. The notes the look comes back with are written into it, unless --dry.
 * Each goal is then one `pnpm make <url> <suite.json> "<goal>"`.
 *
 * The goals also go to .drill/looked/<host>/<time>/looked.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { lookForGoals } from "../src/api.js";
import { addToSuite, fromCwd, loadTarget, outDir, readSuite, secs, TARGET_FLAGS, TARGET_USAGE } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { ...TARGET_FLAGS, headed: { type: "boolean" }, dry: { type: "boolean" } },
});
const [url, suiteFile] = positionals;
if (!url || !suiteFile) {
  console.error(`usage: pnpm look <url> <suite.json> ${TARGET_USAGE} [--headed] [--dry]`);
  process.exit(2);
}

const suitePath = fromCwd(suiteFile);
const suite = await readSuite(suitePath);
const target = await loadTarget(url, flags);
const out = outDir("looked", url);
await mkdir(out, { recursive: true });

const t0 = Date.now();
const looked = await lookForGoals({ target, suite, artifactsDir: out, headless: !flags.headed }, undefined, (text) => console.log(`[${secs(Date.now() - t0).trim()}] ${text}`));
await writeFile(path.join(out, "looked.json"), JSON.stringify(looked, null, 2));

if (looked.summary) console.log(`\n${looked.summary}`);
if (looked.goals.length) console.log(`\nGoals:\n${looked.goals.map((g, i) => `${String(i + 1).padStart(2)}  ${g.goal}\n      ${g.startPath}  (${g.why})`).join("\n")}`);
if (looked.notes.length) console.log(`\nNotes:\n${looked.notes.map((n) => `- ${n}`).join("\n")}`);
if (looked.problems.length) console.log(`\nLooked wrong, and gets a test to find out:\n${looked.problems.map((f) => `- ${f.what}: ${f.saw}\n    ${f.goal ?? ""}`).join("\n")}`);
if (looked.why) console.log(`\nNo goals: ${looked.why}`);
console.log(`\n${secs(looked.durationMs).trim()}, $${looked.costUsd.toFixed(2)}`);

if (looked.notes.length && !flags.dry) {
  // Onto the file as it is now: a make beside this one may have added a test meanwhile.
  await addToSuite(suitePath, suite, { notes: looked.notes.map((text) => ({ text, from: "look" as const })) });
  console.log(`Notes added to ${suiteFile}.`);
}
console.log(out);
process.exit(0);
