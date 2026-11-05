import { join, resolve } from "node:path";
import { CONDITIONS, newId, type DrillTarget } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import type { TestItem, TestOutcome } from "@dappdrill/engine";
import { UsageError, loadTests, testLabels, writeJson, writeText, type SavedTest, type TestsFile } from "../files.js";
import { renderJunit } from "../junit.js";
import { renderMarkdown } from "../markdown.js";
import { dangerous, exitCode, summaryText } from "../outcomes.js";
import { buildTarget, dim, red, type TargetFlags } from "./target.js";
import { interruptSignal } from "./util.js";

export interface RunFlags extends TargetFlags {
  url?: string;
  only?: string;
  unhappy?: boolean;
  junit?: string;
}

/** `dappdrill run`: run the tests in a tests file. See `exitCode` for what it exits with. */
export async function runCommand(file: string, flags: RunFlags): Promise<number> {
  const tests = await loadTests(file);
  if (flags.unhappy) addUnhappyPaths(tests);
  const target = await buildTarget(flags.url ?? tests.url, flags, tests.chains);
  const code = await runTests(tests, target, flags);
  // Steps carry the browser actions that worked; saving them keeps the next run fast.
  await writeJson(file, tests);
  return code;
}

export async function runTests(tests: TestsFile, target: DrillTarget, flags: RunFlags): Promise<number> {
  const all = tests.flows.flatMap((f) => f.tests.map((test) => ({ flow: f.name, test })));
  const picked = flags.only ? all.filter(({ flow, test }) => `${flow} ${test.name}`.toLowerCase().includes(flags.only!.toLowerCase())) : all;
  if (picked.length === 0) throw new UsageError(flags.only ? `No test matches "${flags.only}".` : "There are no tests in the file.");
  const byId = new Map(all.map(({ test }) => [test.id, test]));
  const items: TestItem[] = picked.map(({ test }) => {
    const base = test.baseId ? byId.get(test.baseId) : undefined;
    if (test.baseId && !base) throw new UsageError(`${test.name} is an unhappy path of ${test.baseId}, which isn't in the file.`);
    return { spec: test, base };
  });

  const out = resolve(flags.out);
  const label = testLabels(tests);
  const started = new Map<string, number>();
  const seconds = new Map<string, number>();
  const width = Math.min(60, Math.max(...picked.map(({ test }) => label.get(test.id)!.length)));

  console.log(`Running ${picked.length} ${picked.length === 1 ? "test" : "tests"} on ${target.url}\n`);
  const engine = await loadEngine();
  const { outcomes } = await engine.runTests(
    target,
    items,
    { artifactsDir: join(out, "artifacts"), map: tests.map, setup: tests.setup, headless: !flags.headed, signal: interruptSignal() },
    {
      onSetupSteps: async (steps) => {
        if (tests.setup) tests.setup.steps = steps;
      },
      onStart: async (id) => void started.set(id, Date.now()),
      onDone: async (o) => {
        const secs = Math.round((Date.now() - (started.get(o.testId) ?? Date.now())) / 1000);
        seconds.set(o.testId, secs);
        const name = label.get(o.testId)!.padEnd(width);
        if (o.status === "pass") console.log(`  ✓ ${name}  ${dim(`${secs}s`)}`);
        else if (o.status === "fail" || o.status === "error") {
          console.log(red(`  ✗ ${name}  ${secs}s`));
          if (o.result.failure) console.log(red(`      ${o.result.failure}`));
        } else console.log(dim(`  - ${name}  ${o.status}`));
        for (const r of dangerous(o)) console.log(red(`      Dangerous signature: ${r.title}`));
        learn(byId, o);
      },
    },
  );

  await writeJson(join(out, "results.json"), outcomes);
  await writeText(join(out, "summary.md"), renderMarkdown(tests, outcomes));
  if (flags.junit) await writeText(flags.junit, renderJunit(tests, outcomes, seconds));

  const code = exitCode(outcomes);
  const summary = summaryText(outcomes);
  console.log(`\n${code ? red(summary) : summary}. Videos and screenshots: ${join(flags.out, "artifacts")}`);
  return code;
}

/** Keep what this run learned: the actions that worked, and the text that proved the result. */
function learn(byId: Map<string, SavedTest>, o: TestOutcome) {
  const test = byId.get(o.testId);
  if (!test) return;
  if (o.steps) test.steps = o.steps;
  if (o.proof) test.proof = o.proof;
  const base = test.baseId ? byId.get(test.baseId) : undefined;
  if (base && o.baseSteps) base.steps = o.baseSteps;
}

/** The usual unhappy paths for every happy-path test that doesn't have them yet. */
export function addUnhappyPaths(tests: TestsFile): void {
  for (const flow of tests.flows) {
    flow.tests = flow.tests.flatMap((test) => {
      if (test.baseId) return [test];
      const have = new Set(flow.tests.filter((t) => t.baseId === test.id).map((t) => t.condition));
      const added = CONDITIONS.filter((c) => c.default && !have.has(c.id)).map(
        (c): SavedTest => ({ id: newId("test"), name: c.name, goal: test.goal, expected: c.expected, startPath: test.startPath, steps: [], condition: c.id, baseId: test.id }),
      );
      return [test, ...added];
    });
  }
}
