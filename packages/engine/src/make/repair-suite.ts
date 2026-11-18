/**
 * Repairing a suite: what a run couldn't do with no model. A model does the lines that have no code, or
 * whose recording no longer fits the page, and what it did is recorded; a check still left as a sentence
 * is written as code from the page a model answered it on. Then the test is run with no model, and it
 * is handed back once two runs in a row went the way the model's run did. The setup and the reset come
 * first: every test starts from them.
 *
 * A test that fails on a check while every line of it works as code is a failure of the app or of the
 * check, not something to repair: it is left as it is, with that said.
 */
import { isCode, setupWithRecordings, withRecordings, type Action, type CodeAssert, type DrillEventSink, type Suite, type Test, type TestResult } from "@dappdrill/core";
import { isNothingToDo } from "../run/running.js";
import { openSuite, type OpenSuite, type RunSuiteInput } from "../run/suite.js";
import { spending } from "./each.js";
import { PROVEN_AFTER, quoted, same, withCodeCheck } from "./prove.js";
import { writeCheck } from "./repair.js";

/** Runs of one test before it is given up. */
const MAX_RUNS = 6;
/** How often a model may be given a test to do: the first time, and once more when what it recorded didn't hold. */
const MAX_MODEL_RUNS = 2;

export interface RepairInput extends RunSuiteInput {
  /** The tests to repair. Missing: every test with a line that isn't code, after the setup and the reset. */
  testIds?: string[];
  maxUsd?: number;
}

export interface Repaired {
  /** The setup and the reset as they stand now, when repairing changed them. */
  setup?: Suite["setup"];
  reset?: Suite["reset"];
  tests: {
    testId: string;
    /** The test to keep in place of the old one: proven twice with no model. */
    test?: Test;
    /** Why it couldn't be repaired. */
    why?: string;
  }[];
  costUsd: number;
  durationMs: number;
}

export interface RepairProgress {
  onStart?(testId: string): void;
  onTest?(done: Repaired["tests"][number]): void | Promise<void>;
  say?(text: string): void;
}

type Part = NonNullable<Suite["setup"]>;

/** A line recorded as nothing to do is asked of a model again: there may be something to do this time. */
const askAgain = <L extends Test["steps"][number]>(line: L): L => (line.type === "action" && line.by === "code" && isNothingToDo(line.run) ? { ...line, run: [] } : line);
const partAgain = (part: Part | undefined): Part | undefined => part && { ...part, steps: part.steps.map(askAgain) as Action[] };
const allCode = (part: Part | undefined) => !part || part.steps.every(isCode);

export async function repairSuite(input: RepairInput, sink: DrillEventSink = () => {}, progress: RepairProgress = {}): Promise<Repaired> {
  const t0 = Date.now();
  const { suite } = input;
  const say = progress.say ?? (() => {});
  const spent = spending(input.maxUsd);
  const asked = suite.tests.filter((t) => (input.testIds ? input.testIds.includes(t.id) : ![...t.steps, ...t.cleanup].every(isCode)));
  const out: Repaired = { tests: [], costUsd: 0, durationMs: 0 };
  const done = (): Repaired => ({ ...out, costUsd: spent.spent(), durationMs: Date.now() - t0 });
  const tell = async (told: Repaired["tests"][number]) => {
    out.tests.push(told);
    await progress.onTest?.(told);
  };
  /** The tests not reached yet all end the same way. */
  const none = async (why: string) => {
    for (const test of asked.slice(out.tests.length)) await tell({ testId: test.id, why });
    return done();
  };

  // The setup and the reset first, with a model for what has no code. They are done whichever tests were
  // asked for (an empty list means the two alone): a recording that stopped fitting the page looks like code too.
  const again = { setup: partAgain(suite.setup), reset: partAgain(suite.reset) };
  if (!allCode(again.setup)) say("Doing the setup, and recording it");
  let open = await openSuite({ ...input, suite: { ...suite, ...again } }, sink, { byModel: true });
  let settle = spent.follow(open.env.costUsd);
  try {
    if (open.stuck) return await none(open.stuck);
    const kept = open.env.target.account === "kept";
    let setup = suite.setup;
    let reset = suite.reset;
    if (again.setup && open.setup) setup = setupWithRecordings(again.setup, open.setup);
    if (again.reset && kept) {
      say("Doing the reset");
      const start = await open.fresh();
      if (start.why) return await none(start.why);
      reset = setupWithRecordings(again.reset, start.reset ?? []);
    }
    if (!same(setup, suite.setup) || !same(reset, suite.reset)) {
      // What was recorded has to hold with no model, and the tests are run from it.
      say("Checking that what was recorded works with no model");
      await open.close();
      settle();
      open = await openSuite({ ...input, suite: { ...suite, setup, reset } }, sink, {});
      settle = spent.follow(open.env.costUsd);
      const start = !open.stuck && kept && reset ? await open.fresh() : undefined;
      const why = open.stuck ?? start?.why;
      if (why) return await none(`What a model did was recorded, and it didn't work with no model. ${why}`);
      if (!same(setup, suite.setup)) out.setup = setup;
      if (!same(reset, suite.reset)) out.reset = reset;
    }

    for (const test of asked) {
      input.signal?.throwIfAborted();
      const over = spent.over();
      if (over) return await none(over);
      progress.onStart?.(test.id);
      say(`Repairing “${test.name}”`);
      const repaired = await repairTest(open, test, { ...input, say, overBudget: spent.over });
      say("test" in repaired ? `“${test.name}” went the same way twice with no model` : `“${test.name}” wasn't repaired: ${repaired.why}`);
      await tell({ testId: test.id, ...repaired });
    }
    return done();
  } finally {
    settle();
    await open.close();
    // What was spent reaches the caller even when the repair was stopped and nothing is returned.
    await Promise.resolve(sink({ type: "cost", usd: spent.spent() })).catch(() => {});
  }
}

interface RepairTestOptions {
  artifactsDir: string;
  signal?: AbortSignal;
  say(text: string): void;
  overBudget(): string | undefined;
}

/** One test: a run with a model, then runs with none until two in a row go the way that one did. */
async function repairTest(open: Pick<OpenSuite, "env" | "run">, kept: Test, opts: RepairTestOptions): Promise<{ test: Test } | { why: string }> {
  let test: Test = { ...kept, steps: kept.steps.map(askAgain), cleanup: kept.cleanup.map(askAgain) };
  /** The run a model had a hand in: the runs with no model have to go the way it did. */
  let answered: TestResult | undefined;
  /** The checks written as code from that run, by line, and the ones written a second time. */
  let written = new Map<number, CodeAssert>();
  const rewritten = new Set<number>();
  let modelRuns = 0;
  let steady = 0;

  for (let n = 1; n <= MAX_RUNS; n++) {
    opts.signal?.throwIfAborted();
    const over = opts.overBudget();
    if (over) return { why: over };
    const byModel = answered === undefined;
    const result = await open.run(test, { byModel });
    opts.say(`Run ${n}${byModel ? ", with a model" : ""}: ${result.outcome}${result.reason ? `. ${result.reason}` : ""}`);
    if (!result.steps.some((s) => s.status !== "skipped")) return { why: result.reason ?? "The test couldn't be started." };

    if (byModel) {
      modelRuns++;
      test = withRecordings(test, result);
      written = new Map();
      for (const [line, l] of test.steps.entries()) {
        const how = result.steps[line]!;
        if (l.type !== "check" || l.by !== "llm" || (how.status !== "pass" && how.status !== "fail")) continue;
        const code = await writeCheck(open.env.fastLlm(), { test, run: result, line, artifactsDir: opts.artifactsDir, signal: opts.signal });
        if ("cannot" in code) return { why: `No check by code can say ${quoted(test, line)}. ${code.cannot}` };
        written.set(line, code.expect);
        test = withCodeCheck(test, line, code.expect);
      }
      // Every line the run got to has to be code now. The ones after a check that fails are never reached.
      const left = test.steps.findIndex((l, i) => !isCode(l) && result.steps[i]!.status !== "skipped");
      if (left >= 0) return { why: `${quoted(test, left)} couldn't be ${test.steps[left]!.type === "action" ? "done" : "decided"} by a model either: ${result.steps[left]!.note || "it didn't work."}` };
      if (same(test, kept)) {
        // Nothing to repair: every line was code and worked.
        if (result.outcome === "failed") return { why: `Its lines all work as code, and it fails: ${result.reason}` };
        steady = 1;
      } else steady = 0;
      answered = result;
      continue;
    }

    // With no model, a recording that doesn't fit the page stops the run: a model does the test once more.
    if (result.repairable) {
      const at = result.steps.findIndex((s) => s.status !== "pass");
      if (modelRuns >= MAX_MODEL_RUNS) return { why: `What a model did for ${quoted(test, at)} was recorded twice, and didn't work with no model: ${result.steps[at]!.note}` };
      opts.say(`The recording of ${quoted(test, at)} didn't work with no model`);
      answered = undefined;
      continue;
    }
    const was: TestResult = answered!;
    const off = result.steps.findIndex((s, i) => s.status !== was.steps[i]!.status);
    if (off < 0) {
      if (++steady >= PROVEN_AFTER) return { test };
      continue;
    }
    // A check just written that reads the page another way than the model did gets one more writing.
    const tried = written.get(off);
    const went = `${quoted(test, off)} went another way with no model (${result.steps[off]!.note || result.steps[off]!.status}) than with one (${was.steps[off]!.note || was.steps[off]!.status}).`;
    if (!tried || rewritten.has(off)) return { why: went };
    rewritten.add(off);
    const code = await writeCheck(open.env.fastLlm(), { test, run: result, line: off, tried: { expect: tried, answered: was.steps[off]! }, artifactsDir: opts.artifactsDir, signal: opts.signal });
    if ("cannot" in code) return { why: `${went} ${code.cannot}` };
    opts.say(`Wrote ${quoted(test, off)} as code again: it read the page another way than the model did`);
    written.set(off, code.expect);
    test = withCodeCheck(test, off, code.expect);
    steady = 0;
  }
  return { why: `It didn't go the same way twice in ${MAX_RUNS} runs.` };
}
