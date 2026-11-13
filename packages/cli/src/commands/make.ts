import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONNECTED } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { TestsFile, UsageError, loadTests, suiteOf, writeJson } from "../files.js";
import { buildTarget, dim, warnSink, yellow, type TargetFlags } from "./target.js";
import { interruptSignal } from "./util.js";

export interface MakeFlags extends TargetFlags {
  file: string;
  count?: string;
  goal?: string;
  start?: string;
}

const secs = (ms: number) => `${Math.round(ms / 1000)}s`;

/**
 * `dappdrill make`: look at the app, make a test for each thing worth one, and keep those that go the
 * same way twice in a row. With --goal it makes the one test asked for. The tests file is written
 * after every kept test, so a make that is stopped keeps what it had. Exits 0 when it kept a test.
 */
export async function makeCommand(url: string, flags: MakeFlags): Promise<number> {
  const count = flags.count === undefined ? undefined : Number(flags.count);
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) throw new UsageError(`Bad --count "${flags.count}": expected a whole number.`);
  const known = await access(flags.file).then(() => true, () => false);
  // A new file starts with a user whose wallet is connected.
  const file = known ? await loadTests(flags.file) : TestsFile.parse({ url, setup: CONNECTED });
  const had = file.tests.length;
  const input = { artifactsDir: join(resolve(flags.out), "make"), headless: !flags.headed, signal: interruptSignal() };
  const engine = await loadEngine();
  const t0 = Date.now();
  let costUsd = 0;

  if (flags.goal) {
    // One more test for an app whose tests were made before starts where they did: the same chains, the same tokens.
    const target = await buildTarget(url, flags, "run", file);
    console.log(`Making a test on ${url}: ${flags.goal}\n`);
    const made = await engine.makeTest({ ...input, target, suite: suiteOf(file), goal: flags.goal, startPath: flags.start }, warnSink, (text) => console.log(dim(`  ${text}`)));
    costUsd = made.costUsd;
    if (made.proven && made.test) {
      const notes = new Set(file.notes.map((n) => n.text));
      file.notes.push(...made.notes.filter((n) => !notes.has(n)).map((text) => ({ text, from: "maker" as const })));
      file.tests.push(made.test);
      await writeJson(flags.file, file);
      console.log(`\n  ${made.test.name}: ${made.stands === "passed" ? "passes" : "fails on a fault of the app"} twice in a row`);
    } else console.log(yellow(`\n  No test: ${made.why ?? "it didn't go the same way twice in a row."}`));
  } else {
    const target = await buildTarget(url, flags, "make", file);
    console.log(`Looking at ${url}\n`);
    const made = await engine.makeTests({ ...input, target, suite: suiteOf(file), count }, warnSink, {
      say: (text, n) => console.log(dim(`  ${n ? `(${n}) ` : ""}${text}`)),
      onLooked: (looked) => {
        // A run starts where the tests were made: these chains at these blocks, the wallet holding these tokens.
        file.chains = looked.chains;
        file.tokens = looked.tokens;
        if (looked.summary) console.log(`\n${looked.summary}`);
        if (looked.goals.length === 0) console.log(yellow(`\nNothing to test: ${looked.why ?? "the look found no goals."}`));
      },
      onGoal: (goal, n, suspicion) => console.log(`\n(${n}) ${suspicion ? `Looked wrong: ${suspicion.what}. Finding out: ` : ""}${goal}`),
      onAttempt: (a, n) => {
        const spent = a.made ? dim(`  ${secs(a.made.durationMs)}`) : "";
        if (a.kept && a.made?.test) console.log(`  (${n}) ✓ ${a.made.test.name}: ${a.made.stands === "passed" ? "passes" : "fails on a fault of the app"} twice in a row${spent}`);
        else console.log(yellow(`  (${n}) No test: ${a.why ?? "it didn't go the same way twice in a row."}`) + spent);
      },
      onSuite: async (suite) => {
        Object.assign(file, suite);
        await writeJson(flags.file, file);
      },
    });
    costUsd = made.costUsd;
    const faults = made.attempts.flatMap((a) => (a.kept ? (a.made?.findings ?? []).filter((f) => f.proven) : []));
    if (faults.length) console.log(`\nFaults a test fails on:\n${faults.map((f) => `- ${f.what}\n    expected: ${f.expected}\n    saw: ${f.saw}`).join("\n")}`);
  }

  const kept = file.tests.length - had;
  console.log(`\n${kept} ${kept === 1 ? "test" : "tests"} added to ${flags.file} (${file.tests.length} in all). ${secs(Date.now() - t0)}, $${costUsd.toFixed(2)}`);
  if (file.tests.length) console.log(`Run them with: dappdrill run${flags.file === ".dappdrill/tests.json" ? "" : ` ${flags.file}`}`);
  return kept > 0 ? 0 : 2;
}
