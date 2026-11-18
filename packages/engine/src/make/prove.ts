/**
 * Proving a drafted test: it is run until two runs in a row of the very same test go the same way
 * with no model. A run gets a model only while a line isn't code yet, or after a recording stopped
 * working: the model does the line, what it did is recorded, and a check left as a sentence is
 * written as code from what the page showed. Such a run proves nothing. A line that doesn't pass on
 * the way is put right when the test was wrong, and stands when the app was: a test that fails the
 * same way every time because the app doesn't do what the goal asks is a bug found, and is kept.
 * Before it is, someone who didn't write it gets to say whether the app really is at fault (doubt.ts).
 */
import { isCode, OUTCOME_LABEL, sentence, withRecordings, type CodeAssert, type Test, type TestResult } from "@dappdrill/core";
import type { Doubt, DoubtInput } from "./doubt.js";
import type { Finding } from "./draft.js";
import { applyRepair, type Repair, type RepairInput } from "./repair.js";

/** Runs of one test before it is given up. */
const MAX_RUNS = 7;
/** Changes to the test. Running again to find out, or leaving a line to fail, isn't one: the runs limit those. */
const MAX_REPAIRS = 4;
/** Runs in a row, with no model, that must go the same way. */
export const PROVEN_AFTER = 2;
/** How often a model may do an action before the test is given up: no recording of it works on the next run. */
const MAX_RECORDINGS = 3;

export interface ProveInput {
  test: Test;
  /** What the app was already seen to do wrong. */
  problems: Finding[];
  /** What is known about the app. What a repair learns is added, so the next run has it. */
  notes: string[];
  /** One run of the test from a clean start. With `byModel` a model does what has no code, and what it did comes back recorded. */
  run(test: Test, more: { byModel: boolean }): Promise<TestResult>;
  /** A check that is only a sentence, written as code from the run in which a model answered it (repair.ts). */
  asCode(asked: { test: Test; run: TestResult; line: number }): Promise<{ expect: CodeAssert } | { cannot: string }>;
  /** The account is kept from run to run, so what a run leaves behind, the next one starts from. */
  shared?: boolean;
  repair(asked: Omit<RepairInput, "artifactsDir" | "ours">): Promise<Repair>;
  /**
   * Looks in the app for why a line went wrong, changing nothing (cause.ts). Done once a line, when a
   * repair would run the test again without knowing why, or give it up.
   */
  lookInto?(asked: { test: Test; run: TestResult; line: number }): Promise<string | undefined>;
  /** A second opinion on a line the test is about to be kept failing on. Without it the repair's word is taken. */
  doubt?(asked: Omit<DoubtInput, "artifactsDir" | "ours">): Promise<Doubt>;
  /** Why no more runs may start (the spending limit), once that is so. */
  overBudget?(): string | undefined;
  say?(text: string): void;
}

type Found = Finding & { proven: boolean };

export interface Proved {
  /** The test as it stands at the end. */
  test: Test;
  /** Two runs in a row of it went the same way. Only then does it belong in the suite. */
  proven: boolean;
  /** How the proven test goes: it passes, or it fails every time on something the app does wrong. */
  stands?: "passed" | "failed";
  /** Why it isn't proven. */
  why?: string;
  /** Not proven because of something outside this test that would stop other tests of the app too, in one sentence. */
  blocker?: string;
  /** How many of the last runs are of the test as it stands. */
  worded?: number;
  /** What the repairs learned about the app. */
  notes: string[];
  /** What the app did that a user wouldn't accept. `proven` when the test fails on it every time. */
  findings: Found[];
  /** What was changed after the draft and why, in order. */
  repairs: string[];
  /** What the test failed on every time and a second look wouldn't put on the app, each as that look's reason. */
  dismissed: string[];
  runs: TestResult[];
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A line as the reader knows it: by its sentence. Its number means nothing to them. */
export const quoted = (test: Test, i: number) => `“${sentence(test.steps[i]!)}”`;
/** The test with the check at `line` written as code. */
export const withCodeCheck = (test: Test, line: number, expect: CodeAssert): Test => ({
  ...test,
  steps: test.steps.map((s, i) => (i === line ? { type: "check" as const, by: "code" as const, claim: sentence(s), expect } : s)),
});

export async function prove(input: ProveInput): Promise<Proved> {
  const say = input.say ?? (() => {});
  const out: Proved = { test: input.test, proven: false, notes: [], findings: input.problems.map((p) => ({ ...p, proven: false })), repairs: [], dismissed: [], runs: [] };
  const done = (why?: string, stands?: Proved["stands"]): Proved => ({ ...out, proven: stands !== undefined, stands, why, worded: worded.length });
  const blocked = (why: string, blocker: string): Proved => ({ ...done(why), blocker });

  /** Runs of the test as it is worded now. */
  let worded: TestResult[] = [];
  /** How many runs in a row went the same way with nothing changed after them. */
  let steady = 0;
  /** The lines left to fail because the app is wrong there, by their sentence, with what was found. */
  const standing = new Map<string, Found | undefined>();
  /** How often a model did each action, by its sentence. */
  const recordings = new Map<string, number>();
  /** The action whose recording stopped working in the last run, by its sentence: the next run gets a model to do it again. */
  let broke: string | undefined;
  /** Cleanup lines with no code that the last run needed, by their sentence. A model gets one run to do each and record it. */
  let untidied: string[] = [];
  const tidied = new Set<string>();
  const undecided = new Map<string, number>();
  /** Lines left to fail that a second look agreed with, by their sentence. */
  const upheld = new Set<string>();
  /** Lines whose cause was looked for in the app. */
  const looked = new Set<string>();
  let repairs = 0;
  /** Runs in a row in which no line was done. */
  let emptyRuns = 0;
  const reworded = (to: Test) => {
    out.test = to;
    worded = [];
    steady = 0;
  };
  /** Lines by their sentence that passed in some run. One that also didn't is unsteady. */
  const passedOnce = new Set<string>();
  /** Why the test was about to be given up, when a check that went both ways was taken out for a last try instead. */
  let lastTry: string | undefined;
  /** Where the last try's runs end. */
  let lastRun = MAX_RUNS;
  /**
   * Out of runs or repairs on a check that passed before: the test gets PROVEN_AFTER more runs
   * without it. A goal is worth a test that checks a little less, more than no test at all.
   */
  const tryWithout = (test: Test, line: number, why: string): boolean => {
    const l = test.steps[line];
    if (lastTry || l?.type !== "check" || !passedOnce.has(sentence(l))) return false;
    const without = applyRepair(test, { verdict: "test", why, edits: [{ line: line + 1, op: "remove" }] });
    if ("wrong" in without) return false;
    lastTry = why;
    lastRun = out.runs.length + PROVEN_AFTER;
    out.repairs.push(`${quoted(test, line)} was taken out: it passed in some runs and not in others.`);
    say(`Taking out ${quoted(test, line)} for a last try: it passed in some runs and not in others`);
    standing.delete(sentence(l));
    reworded(without.test);
    return true;
  };

  runs: for (;;) {
    if (out.runs.length >= lastRun) {
      // Out of runs. When a run of the test as it is worded now went wrong at a check that passed in another, a last try without it.
      const wrong = worded.map((r) => unexpected(out.test, r, standing)).findLast((i) => i >= 0);
      if (lastTry || wrong === undefined || !tryWithout(out.test, wrong, `Still not steady after ${MAX_RUNS} runs.`)) break;
    }
    const over = input.overBudget?.();
    if (over) return done(over);
    const before = out.test;
    // A model only for what isn't code yet, or isn't any more. An action no recording holds for is given up.
    const needed = [...before.steps.filter((l) => !isCode(l)).map(sentence), ...(broke ? [broke] : []), ...untidied];
    const worn = needed.find((key) => (recordings.get(key) ?? 0) >= MAX_RECORDINGS);
    if (worn) return done(`“${worn}” was done by a model ${MAX_RECORDINGS} times, and what was recorded never worked on the next run.`);
    const byModel = needed.length > 0;
    broke = undefined;
    const result = await input.run(before, { byModel });
    out.runs.push(result);
    say(`Run ${out.runs.length}: ${OUTCOME_LABEL[result.outcome]}, ${(result.durationMs / 1000).toFixed(0)} s, $${result.costUsd.toFixed(2)}${result.reason ? `. ${result.reason}` : ""}`);

    // A run in which no line was done (our side broke, or the app shut us out first) says nothing about the test.
    if (!result.steps.some((s) => s.status !== "skipped")) {
      steady = 0;
      if (++emptyRuns >= 2) return done(`Two runs in a row did nothing. ${result.reason ?? ""}`.trim());
      continue;
    }
    emptyRuns = 0;
    worded.push(result);
    for (const [i, s] of result.steps.entries()) if (s.status === "pass" && before.steps[i]) passedOnce.add(sentence(before.steps[i]!));

    for (const [i, s] of result.steps.entries()) {
      const line = before.steps[i]!;
      if (line.type === "action" && s.by === "llm" && s.status === "pass") recordings.set(line.do, (recordings.get(line.do) ?? 0) + 1);
    }
    let test = (out.test = withRecordings(before, result));
    // A check a model answered from its sentence is written as code now, from the page it was answered on.
    for (let line = test.steps.length - 1; byModel && line >= 0; line--) {
      const l = test.steps[line]!;
      const how = result.steps[line]!;
      if (l.type !== "check" || l.by !== "llm" || (how.status !== "pass" && how.status !== "fail")) continue;
      const written = await input.asCode({ test, run: result, line });
      if ("expect" in written) {
        test = out.test = withCodeCheck(test, line, written.expect);
        continue;
      }
      const without = applyRepair(test, { verdict: "test", why: written.cannot, edits: [{ line: line + 1, op: "remove" }] });
      if ("wrong" in without) return done(`${quoted(test, line)} can't be checked by code, and the test has no other check. ${written.cannot}`);
      out.repairs.push(`${quoted(test, line)} was taken out: no check by code can say it. ${written.cannot}`);
      say(`Taking out ${quoted(test, line)}: no check by code can say it. ${written.cannot}`);
      // Its line is gone from the test, so the lines of this run no longer stand for the test's: it is run again.
      reworded(without.test);
      continue runs;
    }
    // A run a model had a hand in proves nothing, even when the test came out of it the same.
    const changed = [...result.steps, ...result.cleanup].some((s) => s.by === "llm" && s.status !== "skipped") || !same(test, before);

    // With no model, a recording that no longer fits the page stops the run. A model does that action again in the next.
    if (result.repairable) {
      const at = result.steps.findIndex((s) => s.status !== "pass");
      broke = sentence(before.steps[at]!);
      say(`The recording of ${quoted(before, at)} didn't work: ${result.steps[at]!.note}`);
      steady = 0;
      continue;
    }

    // On a shared account the next run starts from what this one left: after a cleanup that didn't finish, no run can be counted on.
    // A cleanup line with no code is one no model was there to do: the next run has one, once.
    const undone = (c: TestResult["cleanup"][number], i: number) => c.status !== "pass" && !byModel && before.cleanup[i] !== undefined && !isCode(before.cleanup[i]!);
    untidied = result.cleanup.flatMap((c, i) => (undone(c, i) && !tidied.has(before.cleanup[i]!.do) ? [before.cleanup[i]!.do] : []));
    for (const key of untidied) tidied.add(key);
    const untidy = input.shared ? result.cleanup.findIndex((c, i) => c.status !== "pass" && !undone(c, i)) : -1;
    if (untidy >= 0) {
      const how = result.cleanup[untidy]!;
      const what = `the cleanup of “${test.name}” didn't finish (“${before.cleanup[untidy]?.do}”: ${how.note || how.status})`;
      say(`Stopping: ${what}`);
      return blocked(`Stopped because ${what}, and the next run would start from what this one left.`, `The account may still hold what an earlier test left: ${what}.`);
    }

    // Every line passed and it still failed: the page threw an error, or the wallet was asked for something dangerous.
    if (result.outcome === "failed" && result.steps.every((s) => s.status === "pass")) {
      const again = worded.length > 1 && worded.at(-2)!.reason === result.reason;
      steady = changed ? 0 : again ? steady + 1 : 1;
      if (steady < PROVEN_AFTER) continue;
      out.findings.push({ what: result.reason!, expected: "A page that throws no errors and asks the wallet for nothing dangerous.", saw: result.reason!, proven: true });
      return done(undefined, "failed");
    }

    // Every line that went another way than expected is decided from this one run, the first one first.
    let stoodNow = false;
    for (let line = unexpected(test, result, standing); line >= 0; line = unexpected(test, result, standing)) {
      const how = result.steps[line]!;
      if (lastTry) return done(lastTry);
      if (repairs >= MAX_REPAIRS) {
        const why = `Still not steady after ${MAX_REPAIRS} repairs. ${quoted(test, line)}: ${how.note || how.status}`;
        if (tryWithout(test, line, why)) continue runs;
        return done(why);
      }
      const flips = how.status === "pass" || worded.slice(0, -1).some((r) => r.steps[line]?.status === "pass");
      const asked = { test, runs: worded, line, flips, earlier: out.repairs, notes: input.notes, problems: out.findings };
      let fix = await input.repair(asked);
      const key = sentence(test.steps[line]!);

      // Before running again without knowing why, or giving up: what the app shows about it.
      const repairedBefore = out.repairs.length > 0;
      const unsure = fix.verdict === "cant-tell" || fix.verdict === "in-the-way" || (fix.verdict === "test" && !fix.edits.length) || (fix.again && repairedBefore);
      if (unsure && input.lookInto && !looked.has(key)) {
        looked.add(key);
        const cause = await input.lookInto({ test, run: result, line }).catch(() => undefined);
        if (cause) {
          say(`Looked into why ${quoted(test, line)} went wrong: ${cause}`);
          fix = await input.repair({ ...asked, earlier: [...out.repairs], cause });
          out.repairs.push(`Looked into why ${quoted(test, line)} went wrong: ${cause}`);
        }
      }

      if (fix.verdict === "in-the-way") {
        say(`Something is in the way at ${quoted(test, line)}: ${fix.why}`);
        return blocked(`${quoted(test, line)}: ${fix.why}`, fix.blocker ?? fix.why);
      }
      // A repair that didn't change what goes wrong: the next one won't either.
      if (fix.again && repairedBefore) {
        say(`Giving up: repairs didn't change what goes wrong at ${quoted(test, line)}`);
        return done(`Repairs didn't change what goes wrong at ${quoted(test, line)}: ${fix.why}`);
      }

      if (fix.verdict === "cant-tell" || (fix.verdict === "test" && !fix.edits.length)) {
        const times = (undecided.get(key) ?? 0) + 1;
        undecided.set(key, times);
        out.repairs.push(`${quoted(test, line)} didn't go the same way and it couldn't be told why: ${fix.why}`);
        say(`Couldn't tell about ${quoted(test, line)}: ${fix.why}`);
        steady = 0;
        if (times < 2) continue runs;
        if (test.steps[line]!.type === "action") return done(`${quoted(test, line)} couldn't be done twice, and it couldn't be told why. ${fix.why}`);
        const without = applyRepair(test, { ...fix, edits: [{ line: line + 1, op: "remove" }] });
        if ("wrong" in without) return done(`${quoted(test, line)} couldn't be decided twice, and the test has nothing left without it.`);
        out.repairs.push(`${quoted(test, line)} was taken out: it couldn't be decided twice.`);
        standing.delete(key);
        reworded(without.test);
        continue runs;
      }

      if (fix.note) {
        out.notes.push(fix.note);
        input.notes.push(fix.note);
      }
      // One fault is written down once, whoever saw it first.
      let finding = fix.known ? out.findings[fix.known - 1] : undefined;
      if (!finding && fix.finding) out.findings.push((finding = { ...fix.finding, proven: false }));

      if (!fix.edits.length && test.steps[line]!.type === "action") {
        // With no model, an action the app won't take can't be told from a recording that stopped working.
        repairs++;
        out.repairs.push(`The app is wrong at ${quoted(test, line)}: ${fix.why} An action can't be left to fail, and no check was put before it to say what is wrong.`);
        say(`The app is wrong at ${quoted(test, line)}, and no check says so yet: ${fix.why}`);
        steady = 0;
        continue runs;
      }
      if (!fix.edits.length) {
        // The app is wrong and the line stands. The lines after it in this run are looked at next.
        standing.set(key, finding);
        out.repairs.push(`${quoted(test, line)} is left to fail, because the app is wrong: ${fix.why}`);
        say(`The app is wrong at ${quoted(test, line)}: ${fix.why}`);
        if (how.status === "fail") {
          stoodNow = true;
          continue;
        }
        // It has to be seen to fail before it counts.
        steady = 0;
        continue runs;
      }

      repairs++;
      const edited = applyRepair(test, fix);
      if ("wrong" in edited) {
        out.repairs.push(`A repair of ${quoted(test, line)} wasn't taken: ${edited.wrong}`);
        say(`A repair wasn't taken: ${edited.wrong}`);
        steady = 0;
        continue runs;
      }
      out.repairs.push(`${quoted(test, line)}, ${fix.verdict === "app" ? "the app is wrong and the test goes round it" : "the test was wrong"}: ${fix.why} ${describeEdits(test, fix.edits)}`);
      say(`Repaired ${quoted(test, line)}: ${fix.why}`);
      reworded(edited.test);
      continue runs;
    }

    // The run went the way the test is expected to go. The one that first showed a fault is the first of its kind.
    steady = changed ? 0 : stoodNow ? 1 : steady + 1;
    if (steady < PROVEN_AFTER) continue;
    const failed = result.steps.flatMap((s, i) => (s.status === "fail" ? [i] : []));
    // It is about to be kept as failing. One look for each fault it fails on, by someone who didn't write it.
    for (const line of input.doubt ? failed : []) {
      const key = sentence(test.steps[line]!);
      const finding = standing.get(key);
      if (upheld.has(key)) continue;
      const second = await input.doubt!({ test, run: result, line, finding, notes: input.notes });
      if (second.verdict === "app") {
        say(`A second look agrees the app is at fault at ${quoted(test, line)}: ${second.why}`);
        for (const [other, f] of standing) if (other === key || (finding && f === finding)) upheld.add(other);
        continue;
      }
      const not = `${quoted(test, line)} fails every time, and a second look didn't put it on the app: ${second.why}`;
      out.repairs.push(not);
      out.dismissed.push(second.why);
      say(`A second look at ${quoted(test, line)} didn't put it on the app: ${second.why}`);
      for (const [other, f] of [...standing]) if (other === key || (finding && f === finding)) standing.delete(other);
      if (finding) out.findings.splice(out.findings.indexOf(finding), 1);
      if (repairs >= MAX_REPAIRS) return done(not);
      repairs++;
      const fix = await input.repair({ test, runs: worded, line, flips: false, earlier: out.repairs, notes: input.notes, problems: out.findings, objection: second.why });
      const edited = fix.verdict === "test" && fix.edits.length ? applyRepair(test, fix) : { wrong: "No way was found to word it." };
      if ("wrong" in edited) return done(not);
      out.repairs.push(`${quoted(test, line)} was put another way: ${fix.why} ${describeEdits(test, fix.edits)}`);
      say(`Reworded ${quoted(test, line)}: ${fix.why}`);
      reworded(edited.test);
      continue runs;
    }
    for (const line of failed) {
      const finding = standing.get(sentence(test.steps[line]!));
      if (finding) finding.proven = true;
    }
    return done(undefined, failed.length ? "failed" : "passed");
  }
  return done(lastTry ?? `Still not steady after ${MAX_RUNS} runs.`);
}

/**
 * The first line that didn't go the way it is expected to, or -1. A check left to fail has to fail,
 * every other line has to pass. Once a check left to fail has failed, the lines the run didn't get
 * to are as expected.
 */
function unexpected(test: Test, result: TestResult, standing: Map<string, unknown>): number {
  let stopped = false;
  for (const [i, { status }] of result.steps.entries()) {
    const line = test.steps[i]!;
    const unreached = stopped && status === "skipped";
    if (!standing.has(sentence(line))) {
      if (status !== "pass" && !unreached) return i;
    } else if (status === "fail") {
      stopped = true;
    } else if (!unreached) return i;
  }
  return -1;
}

function describeEdits(test: Test, edits: Repair["edits"]): string {
  return edits
    .map((e) => {
      const old = test.steps[e.line - 1];
      if (e.op === "remove") return `Took out “${old ? sentence(old) : e.line}”.`;
      if (e.op === "insert-before") return old ? `Added “${e.with?.text}” before “${sentence(old)}”.` : `Added “${e.with?.text}” at the end.`;
      return `“${old ? sentence(old) : e.line}” became “${e.with?.text}”.`;
    })
    .join(" ");
}
