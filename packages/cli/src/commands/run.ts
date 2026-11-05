import { join, resolve } from "node:path";
import { CONDITIONS, newId, walletUse, type DrillTarget, type EdgeCaseId } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import type { TestItem, TestOutcome } from "@dappdrill/engine";
import { UsageError, loadTests, pickConditions, writeJson, writeText, type SavedTest, type TestsFile } from "../files.js";
import { renderJunit } from "../junit.js";
import { renderMarkdown } from "../markdown.js";
import { DANGEROUS_FAILS, distinctReviews, exitCode, reviewLine, reviewsLine, tally, tallyLine } from "../outcomes.js";
import { buildTarget, dim, red, yellow, type TargetFlags } from "./target.js";
import { interruptSignal } from "./util.js";

export interface RunFlags extends TargetFlags {
  url?: string;
  only?: string;
  unhappy?: boolean;
  condition: string[];
  failOnDangerous?: boolean;
  junit?: string;
}

/** `dappdrill run`: run the tests in a tests file. Exits 1 when one fails, 2 when we can't tell. */
export async function runCommand(file: string, flags: RunFlags): Promise<number> {
  const tests = await loadTests(file);
  const target = await buildTarget(flags.url ?? tests.url, flags, tests.chains);
  const code = await runTests(tests, target, flags);
  // Steps carry the browser actions that worked; saving them keeps the next run fast.
  await writeJson(file, tests);
  return code;
}

export async function runTests(tests: TestsFile, target: DrillTarget, flags: RunFlags): Promise<number> {
  const conditions = pickConditions(flags);
  addUnhappyPaths(tests, conditions);
  const first = pickTests(tests, flags.only);
  if (first.length === 0) throw new UsageError(flags.only ? `No test matches "${flags.only}".` : "There are no tests in the file.");

  const out = resolve(flags.out);
  const seconds = new Map<string, number>();
  const signal = interruptSignal();
  const engine = await loadEngine();

  const runBatch = async (picked: Picked[]): Promise<TestOutcome[]> => {
    const all = tests.flows.flatMap((f) => f.tests);
    const byId = new Map(all.map((test) => [test.id, test]));
    const items: TestItem[] = picked.map(({ test }) => {
      const base = test.baseId ? byId.get(test.baseId) : undefined;
      if (test.baseId && !base) throw new UsageError(`${test.name} is an unhappy path of ${test.baseId}, which isn't in the file.`);
      return { spec: test, base };
    });
    const label = new Map(picked.map(({ flow, test }) => [test.id, `${flow} · ${test.name}`]));
    const started = new Map<string, number>();
    const width = Math.min(60, Math.max(...[...label.values()].map((l) => l.length)));

    console.log(`Running ${picked.length} ${picked.length === 1 ? "test" : "tests"} on ${target.url}\n`);
    const { outcomes } = await engine.runTests(
      target,
      items,
      { artifactsDir: join(out, "artifacts"), map: tests.map, setup: tests.setup, headless: !flags.headed, signal },
      {
        onSetupSteps: async (steps) => {
          if (tests.setup) tests.setup.steps = steps;
        },
        onStart: async (id) => void started.set(id, Date.now()),
        onDone: async (o) => {
          const secs = Math.round((Date.now() - (started.get(o.testId) ?? Date.now())) / 1000);
          seconds.set(o.testId, secs);
          printOutcome(label.get(o.testId)!.padEnd(width), secs, o);
          learn(byId, o);
        },
      },
    );
    return outcomes;
  };

  const outcomes = await runBatch(first);
  // A test that reached the wallet for the first time just now can have its unhappy paths.
  const added = new Set(addUnhappyPaths(tests, conditions).map((t) => t.id));
  const second = pickTests(tests, flags.only).filter(({ test }) => added.has(test.id));
  if (second.length > 0 && !signal.aborted) {
    console.log();
    outcomes.push(...(await runBatch(second)));
  }
  const total = first.length + second.length;

  await writeJson(join(out, "results.json"), outcomes);
  await writeText(join(out, "summary.md"), renderMarkdown(tests, outcomes, total, flags.failOnDangerous));
  if (flags.junit) await writeText(flags.junit, renderJunit(tests, outcomes, seconds));

  if (conditions.length > 0) for (const line of noUnhappyPaths(first)) console.log(dim(`\n${line}`));
  const t = tally(outcomes, total);
  const reviewed = distinctReviews(outcomes.flatMap((o) => o.result.signingReviews.map((review) => ({ review })))).map((r) => r.review);
  const reviews = reviewsLine(reviewed);
  const dangerous = !!flags.failOnDangerous && reviewed.some((r) => r.verdict === "dangerous");
  const code = exitCode(t, dangerous);
  console.log(`\n${code ? red(tallyLine(t)) : tallyLine(t)}.${reviews ? ` ${reviews}` : ""} Videos and screenshots: ${join(flags.out, "artifacts")}`);
  if (dangerous) console.log(red(DANGEROUS_FAILS));
  return code;
}

interface Picked {
  flow: string;
  test: SavedTest;
}

/** An unhappy path comes along with its happy path, so --only can name either. */
function pickTests(tests: TestsFile, only?: string): Picked[] {
  const all = tests.flows.flatMap((f) => f.tests.map((test) => ({ flow: f.name, test })));
  if (!only) return all;
  const name = new Map(all.map(({ test }) => [test.id, test.name]));
  return all.filter(({ flow, test }) => `${flow} ${test.baseId ? name.get(test.baseId) : ""} ${test.name}`.toLowerCase().includes(only.toLowerCase()));
}

export function printOutcome(name: string, secs: number, o: TestOutcome) {
  const reason = o.result.failure;
  if (o.status === "pass") console.log(`  ✓ ${name}  ${dim(`${secs}s`)}`);
  else if (o.status === "fail") console.log(red(`  ✗ ${name}  ${secs}s`));
  else if (o.status === "error") console.log(red(`  ! ${name}  couldn't run`));
  else console.log(dim(`  - ${name}  not run`));
  if (reason) console.log((o.status === "fail" || o.status === "error" ? red : dim)(`      ${reason}`));
  for (const r of o.result.signingReviews) {
    if (r.verdict !== "consistent") console.log((r.verdict === "dangerous" ? red : yellow)(`      ${reviewLine(r)}`));
  }
}

/** Why the happy paths that ran have no unhappy paths, so a plain --unhappy never looks like it covered them. */
function noUnhappyPaths(picked: Picked[]): string[] {
  return picked.flatMap(({ flow, test }) => {
    if (test.baseId) return [];
    const use = walletUse(test.steps);
    if (use === "signs") return [];
    return [`No unhappy paths for ${flow} · ${test.name}: ${use === "none" ? "it never asks the wallet to sign." : "no run has reached the wallet yet."}`];
  });
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

/**
 * Adds these unhappy paths to every happy path that asks the wallet to sign and doesn't have
 * them yet. A test that hasn't reached the wallet gets none: there's nothing to reject or pay for.
 */
export function addUnhappyPaths(tests: TestsFile, conditions: EdgeCaseId[]): SavedTest[] {
  const added: SavedTest[] = [];
  for (const flow of tests.flows) {
    flow.tests = flow.tests.flatMap((test) => {
      if (test.baseId || walletUse(test.steps) !== "signs") return [test];
      const have = new Set(flow.tests.filter((t) => t.baseId === test.id).map((t) => t.condition));
      const mine = CONDITIONS.filter((c) => conditions.includes(c.id) && !have.has(c.id)).map(
        (c): SavedTest => ({ id: newId("test"), name: c.name, goal: test.goal, expected: c.expected, startPath: test.startPath, steps: [], condition: c.id, baseId: test.id }),
      );
      added.push(...mine);
      return [test, ...mine];
    });
  }
  return added;
}
