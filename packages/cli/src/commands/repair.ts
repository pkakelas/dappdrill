import { join, resolve } from "node:path";
import { loadEngine } from "@dappdrill/engine/fake";
import { loadTests, suiteOf, writeJson, type TestsFile } from "../files.js";
import { buildTarget, type TargetFlags } from "./target.js";
import { commandOn, dim, interruptSignal, pickTests, secs, warnSink, yellow } from "./util.js";

export interface RepairFlags extends TargetFlags {
  only?: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `dappdrill repair`: write the tests as code again. The setup and the reset first, then every test
 * with a line that isn't code yet or whose code stopped working, or the tests --only names. A model
 * does the lines that code can't, and what it did is kept as code once the test goes the same way with
 * no model. The file is written after every repaired test, so a repair that is stopped keeps what it
 * had. Exits 0 when nothing was left unrepaired.
 */
export async function repairCommand(path: string, flags: RepairFlags): Promise<number> {
  const file = await loadTests(path);
  // With no --only the engine picks: every test with a line that isn't code, or whose code stopped working.
  const named = pickTests(file, flags.only);
  const picked = flags.only ? named : undefined;
  const target = await buildTarget(file.url, flags, "tests", file);
  const engine = await loadEngine();
  const signal = interruptSignal();
  const name = (id: string) => file.tests.find((t) => t.id === id)?.name ?? id;

  // Written onto the file as it is on disk by then, one write at a time, so a hand edit made meanwhile stays.
  let writing = Promise.resolve();
  const write = (change: (now: TestsFile) => TestsFile | undefined) =>
    (writing = writing.catch(() => {}).then(async () => {
      const next = change(await loadTests(path));
      if (next) await writeJson(path, next);
    }));

  console.log(`Repairing ${picked ? (picked.length === 1 ? "1 test" : `${picked.length} tests`) : "the tests"} of ${file.url}\n`);
  const t0 = Date.now();
  let repaired = 0;
  let left = 0;
  let costUsd = 0;
  let stopped = false;
  try {
    const done = await engine.repairSuite({ target, suite: suiteOf(file), artifactsDir: join(resolve(flags.out), "repair"), headless: !flags.headed, signal, testIds: picked?.map((t) => t.id) }, warnSink, {
      say: (text) => console.log(dim(`  ${text}`)),
      onStart: (testId) => console.log(`\n${name(testId)}`),
      onTest: async ({ testId, test, why }) => {
        const was = file.tests.find((t) => t.id === testId);
        let kept = false;
        // A test edited while it was repaired keeps the edit.
        if (test && was) await write((now) => (now.tests.some((t) => t.id === testId && same(t, was)) ? ((kept = true), { ...now, tests: now.tests.map((t) => (t.id === testId ? { ...test, id: testId } : t)) }) : undefined));
        if (kept) repaired++;
        else left++;
        console.log(kept ? `  ✓ ${name(testId)}: repaired` : yellow(`  Not repaired: ${test ? "the file's test changed meanwhile, so it was left as it is." : (why ?? "it didn't go the same way with no model.")}`));
      },
    });
    costUsd = done.costUsd;
    const { setup, reset } = done;
    if (setup) await write((now) => (same(now.setup, file.setup) ? { ...now, setup } : undefined));
    if (reset) await write((now) => (same(now.reset, file.reset) ? { ...now, reset } : undefined));
    if (setup || reset) console.log(`\n  ✓ ${[setup && "The setup", reset && (setup ? "the reset" : "The reset")].filter(Boolean).join(" and ")} ${setup && reset ? "were" : "was"} written as code.`);
    else if (repaired + left === 0) console.log("Nothing needed repairing.");
  } catch (e) {
    // Stopped with Ctrl-C: what was repaired by then is in the file.
    if (!signal.aborted) throw e;
    stopped = true;
  }
  await writing;

  const counts = [`${repaired} ${repaired === 1 ? "test" : "tests"} repaired`, left && `${left} not`].filter(Boolean).join(", ");
  console.log(`\n${stopped ? "Stopped. " : ""}${counts} in ${path}. ${secs(Date.now() - t0)}, $${costUsd.toFixed(2)}`);
  if (repaired) console.log(`Run them with: ${commandOn("run", path)}`);
  return stopped || left ? 2 : 0;
}
