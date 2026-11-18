import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONNECTED } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { TestsFile, UsageError, addToTests, loadTests, suiteOf } from "../files.js";
import { buildTarget, type TargetFlags } from "./target.js";
import { commandOn, dim, interruptSignal, secs, warnSink, yellow } from "./util.js";

export interface MakeFlags extends TargetFlags {
  file: string;
  count?: string;
  goal?: string;
  start?: string;
}

/** How a kept test stands. */
const stands = (made: { stands?: "passed" | "failed" }) => `${made.stands === "passed" ? "passes" : "fails on a fault of the app"} twice in a row`;
/** Why a goal got no test, when the engine gave no reason. */
const NOT_PROVEN = "it didn't go the same way twice in a row.";

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
  const input = { artifactsDir: join(resolve(flags.out), "make"), headless: !flags.headed, signal: interruptSignal() };
  const engine = await loadEngine();
  const t0 = Date.now();
  let costUsd = 0;
  // The file is written with only what this make adds, onto what it holds by then; one write at a time,
  // since the makes going side by side each add their test.
  let kept = 0;
  let inAll = file.tests.length;
  let writing = Promise.resolve();
  // One more test for an app whose tests were made before starts where they did: the same chains, the same account.
  const target = await buildTarget(url, flags, flags.goal ? "tests" : "look", file);
  // The file remembers the account the tests were made on, and never the key.
  const on = { account: target.account, fund: target.fund };
  const add = (more: Parameters<typeof addToTests>[2]) =>
    (writing = writing.catch(() => {}).then(async () => {
      inAll = (await addToTests(flags.file, { ...file, ...on }, { ...on, ...more })).tests.length;
      kept += more.tests?.length ?? 0;
    }));

  if (flags.goal) {
    console.log(`Making a test on ${url}: ${flags.goal}\n`);
    const made = await engine.makeTest({ ...input, target, suite: suiteOf(file), goal: flags.goal, startPath: flags.start }, warnSink, (text) => console.log(dim(`  ${text}`)));
    costUsd = made.costUsd;
    if (made.proven && made.test) {
      await add({ notes: made.notes.map((text) => ({ text, from: "maker" as const })), tests: [made.test] });
      console.log(`\n  ${made.test.name}: ${stands(made)}`);
    } else console.log(yellow(`\n  No test: ${made.why ?? NOT_PROVEN}`));
  } else {
    console.log(`Looking at ${url}\n`);
    let was = suiteOf(file);
    let started: Pick<TestsFile, "chains"> | undefined;
    const made = await engine.makeTests({ ...input, target, suite: was, count }, warnSink, {
      say: (text, n) => console.log(dim(`  ${n ? `(${n}) ` : ""}${text}`)),
      onLooked: (looked) => {
        // A run uses the chains the tests were made on.
        started = { chains: looked.chains };
        if (looked.summary) console.log(`\n${looked.summary}`);
        if (looked.goals.length === 0) console.log(yellow(`\nNothing to test: ${looked.why ?? "the look found no goals."}`));
      },
      onGoal: (goal, n, suspicion) => console.log(`\n(${n}) ${suspicion ? `Looked wrong: ${suspicion.what}. Finding out: ` : ""}${goal}`),
      onAttempt: (a, n) => {
        const spent = a.made ? dim(`  ${secs(a.made.durationMs)}`) : "";
        if (a.kept && a.made?.test) console.log(`  (${n}) ✓ ${a.made.test.name}: ${stands(a.made)}${spent}`);
        else console.log(yellow(`  (${n}) No test: ${a.why ?? NOT_PROVEN}`) + spent);
      },
      onSuite: async (suite) => {
        // What the suite gained since the last write: the look's notes, or a test and what its make learned.
        const notes = suite.notes.filter((n) => !was.notes.some((w) => w.text === n.text));
        const tests = suite.tests.filter((t) => !was.tests.some((w) => w.id === t.id));
        was = suite;
        await add({ notes, tests, ...started });
      },
    });
    costUsd = made.costUsd;
    if (made.stopped) console.log(yellow(`\n${made.stopped} The goals left weren't tried.`));
    const faults = made.attempts.flatMap((a) => (a.kept ? (a.made?.findings ?? []).filter((f) => f.proven) : []));
    if (faults.length) console.log(`\nFaults a test fails on:\n${faults.map((f) => `- ${f.what}\n    expected: ${f.expected}\n    saw: ${f.saw}`).join("\n")}`);
  }

  console.log(`\n${kept} ${kept === 1 ? "test" : "tests"} added to ${flags.file} (${inAll} in all). ${secs(Date.now() - t0)}, $${costUsd.toFixed(2)}`);
  if (inAll) console.log(`Run them with: ${commandOn("run", flags.file)}`);
  return kept > 0 ? 0 : 2;
}
