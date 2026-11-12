/**
 * Looks around an app and lists the goals worth a test.
 *
 *   pnpm look <url> <suite.json> [--chain id[=rpc]]… [--target file] [--headed] [--dry]
 *
 * The suite file gives the setup, what is known about the app and the tests it already has; it
 * needn't be there yet. The notes the look comes back with are written into it, unless --dry.
 * Each goal is then one `pnpm make <url> <suite.json> "<goal>"`.
 *
 * The goals also go to .drill/looked/<host>/<time>/looked.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Suite } from "@dappdrill/core";
import { lookForGoals } from "../src/api.js";
import { fromCwd, loadTarget, outDir, secs } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { chain: { type: "string", multiple: true }, target: { type: "string" }, headed: { type: "boolean" }, dry: { type: "boolean" } },
});
const [url, suiteFile] = positionals;
if (!url || !suiteFile) {
  console.error("usage: pnpm look <url> <suite.json> [--chain id[=rpc]]… [--target file] [--headed] [--dry]");
  process.exit(2);
}

const suitePath = fromCwd(suiteFile);
const suite = Suite.parse(JSON.parse(await readFile(suitePath, "utf8").catch(() => "{}")));
const target = await loadTarget(url, flags);
const out = outDir("looked", url);
await mkdir(out, { recursive: true });

const t0 = Date.now();
const looked = await lookForGoals({ target, suite, artifactsDir: out, headless: !flags.headed }, undefined, (text) => console.log(`[${secs(Date.now() - t0).trim()}] ${text}`));
await writeFile(path.join(out, "looked.json"), JSON.stringify(looked, null, 2));

if (looked.summary) console.log(`\n${looked.summary}`);
if (looked.goals.length) console.log(`\nGoals:\n${looked.goals.map((g, i) => `${String(i + 1).padStart(2)}  ${g.goal}\n      ${g.startPath}  (${g.why})`).join("\n")}`);
if (looked.notes.length) console.log(`\nNotes:\n${looked.notes.map((n) => `- ${n}`).join("\n")}`);
if (looked.why) console.log(`\nNo goals: ${looked.why}`);
console.log(`\n${secs(looked.durationMs).trim()}, $${looked.costUsd.toFixed(2)}`);

if (looked.notes.length && !flags.dry) {
  await writeFile(suitePath, `${JSON.stringify({ ...suite, notes: [...suite.notes, ...looked.notes.map((text) => ({ text, from: "look" as const }))] }, null, 2)}\n`);
  console.log(`Notes added to ${suiteFile}.`);
}
console.log(out);
process.exit(0);
