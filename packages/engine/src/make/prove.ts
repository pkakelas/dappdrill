/**
 * Proving a drafted test: it is run until two runs in a row of the very same test go the same way
 * with nothing redone. A line that doesn't pass on the way is put right when the test was wrong,
 * and stands when the app was: a test that fails the same way every time because the app doesn't
 * do what the goal asks is a bug found, and is kept. Before it is, someone who didn't write it gets
 * to say whether the app really is at fault (doubt.ts).
 */
import { OUTCOME_LABEL, sentence, withRecordings, type Test, type TestResult } from "@dappdrill/core";
import type { Doubt, DoubtInput } from "./doubt.js";
import type { Finding } from "./draft.js";
import { applyRepair, type Repair, type RepairInput } from "./repair.js";

export const MAX_RUNS = 7;
/** Changes to the test. Running again to find out, or leaving a line to fail, isn't one: the runs limit those. */
export const MAX_REPAIRS = 4;
/** Runs in a row that must go the same way. */
export const PROVEN_AFTER = 2;
/** How often an action may be recorded before its recording is given up and a model does it every time. */
export const MAX_RECORDINGS = 3;

export interface ProveInput {
  test: Test;
  /** What the app was already seen to do wrong. */
  problems: Finding[];
  /** What is known about the app. What a repair learns is added, so the next run has it. */
  notes: string[];
  /** One run of the test from a clean start. */
  run(test: Test): Promise<TestResult>;
  repair(asked: Omit<RepairInput, "artifactsDir" | "ours">): Promise<Repair>;
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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A line as the reader knows it: by its sentence. Its number means nothing to them. */
const quoted = (test: Test, i: number) => `“${sentence(test.steps[i]!)}”`;

export async function prove(input: ProveInput): Promise<Proved> {
  const say = input.say ?? (() => {});
  const out: Proved = { test: input.test, proven: false, notes: [], findings: input.problems.map((p) => ({ ...p, proven: false })), repairs: [], dismissed: [], runs: [] };
  const done = (why?: string, stands?: Proved["stands"]): Proved => ({ ...out, proven: stands !== undefined, stands, why, worded: worded.length });

  /** Runs of the test as it is worded now. */
  let worded: TestResult[] = [];
  /** How many runs in a row went the same way with nothing changed after them. */
  let steady = 0;
  /** The lines left to fail because the app is wrong there, by their sentence, with what was found. */
  const standing = new Map<string, Found | undefined>();
  const recordings = new Map<string, number>();
  const undecided = new Map<string, number>();
  /** Lines left to fail that a second look agreed with, by their sentence. */
  const upheld = new Set<string>();
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
    const result = await input.run(before);
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

    const test = (out.test = keepRecordings(before, result, recordings, out.repairs));
    // A recording that had to be made again isn't steady, even when it came out the same.
    const changed = !same(test, before) || result.steps.some((s) => s.redone !== undefined);

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
      const fix = await input.repair({ test, runs: worded, line, flips, earlier: out.repairs, notes: input.notes, problems: out.findings });
      const key = sentence(test.steps[line]!);

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
 * The first line that didn't go the way it is expected to, or -1. A line left to fail has to fail,
 * every other line has to pass. Once a line left to fail has failed, the lines the run didn't get
 * to are as expected, and so is everything after an action that couldn't be done: its checks have
 * nothing to look at.
 */
function unexpected(test: Test, result: TestResult, standing: Map<string, unknown>): number {
  let stopped = false;
  for (const [i, { status }] of result.steps.entries()) {
    const line = test.steps[i]!;
    const unreached = stopped && status === "skipped";
    if (!standing.has(sentence(line))) {
      if (status !== "pass" && !unreached) return i;
    } else if (status === "fail") {
      if (line.type === "action") return -1;
      stopped = true;
    } else if (!unreached) return i;
  }
  return -1;
}

/**
 * The test with the run's recordings written in. An action whose recording had to be made too
 * often, or couldn't be kept, becomes a model's: it can't be the same on every run.
 */
function keepRecordings(test: Test, result: TestResult, counts: Map<string, number>, log: string[]): Test {
  const recorded = withRecordings(test, result);
  const steps = recorded.steps.map((line, i) => {
    if (line.type !== "action" || line.by !== "code" || result.steps[i]?.by !== "llm" || result.steps[i]!.status !== "pass") return line;
    const times = (counts.get(line.do) ?? 0) + 1;
    counts.set(line.do, times);
    if (times < MAX_RECORDINGS) return line;
    log.push(`${quoted(test, i)} is a model's from now on: its recording didn't hold over ${MAX_RECORDINGS} runs.`);
    return { type: "action" as const, by: "llm" as const, do: line.do };
  });
  return { ...recorded, steps };
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
