/**
 * Status rollups, computed at display time from the latest results. Nothing here is stored.
 *
 * A test's read is its latest finished result; a run in progress shows beside it and never
 * erases it. An app reads from its tests, with failed conditions counted alongside them.
 * Signing verdicts are a flag next to the status, never part of it.
 */
import type { TestRunResult, TestRunStatus } from "./test.js";
import type { Verdict } from "./signing.js";

/**
 * What a test (or condition) shows: the latest finished result, plus whatever is in progress.
 * probable: it failed and the failure isn't confirmed. input: it can't go further without its owner.
 * The CLI reads a run's status as it is, so there a run that stopped early is still "error".
 */
export type Settled = "pass" | "fail" | "probable" | "input" | "error" | "skipped" | "never";
export type Active = "queued" | "running";
export interface Read {
  settled: Settled;
  active?: Active;
}

export const SETTLED_LABEL: Record<Settled, string> = {
  pass: "Passed",
  fail: "Failed",
  probable: "Probably failed",
  input: "Needs your input",
  error: "Couldn't run",
  skipped: "Doesn't apply",
  never: "Not run yet",
};
export const ACTIVE_LABEL: Record<Active, string> = { queued: "Queued", running: "Running" };

/** `latest` is the newest result of any status, `settled` the newest one that finished. */
export function readOf(latest?: { status: TestRunStatus }, settled?: { status: TestRunStatus }): Read {
  const s = settled?.status;
  const read: Read = { settled: s === "pass" || s === "fail" || s === "error" || s === "skipped" ? s : "never" };
  if (latest?.status === "queued" || latest?.status === "running") read.active = latest.status;
  return read;
}

type Judged = { status: TestRunStatus; result?: Pick<TestRunResult, "blame" | "secondLook"> | null };

/**
 * What a finished run says once whose move it is has been read. Failed means the app: a second look
 * confirmed it, or nobody asked for one (`checked` false: a condition, a CLI run). A run that
 * stopped early is never the app's. A test that is set aside reads Doesn't apply.
 */
export function settle(run: Judged | undefined, checked = true, passedBefore = true): Settled {
  if (!run) return "never";
  const look = run.result?.secondLook?.verdict;
  if (setAside(run, passedBefore)) return "skipped";
  if (run.status === "fail") return look === "test" ? "input" : look === "app" || !checked ? "fail" : "probable";
  if (run.status === "error") return run.result?.blame === "input" || !run.result?.blame ? "input" : "never";
  return run.status === "pass" || run.status === "skipped" ? run.status : "never";
}

/**
 * The app doesn't offer what the test asks for and the test has never passed, so it shouldn't be a
 * test: it is set aside, out of the counts and the runs, with nothing for its owner to do. One that
 * passed before stays theirs to look at, since the app may have lost the feature.
 */
export const setAside = (run: Judged | undefined, passedBefore: boolean) =>
  !passedBefore && run?.status === "fail" && run.result?.secondLook?.verdict === "test" && run.result.secondLook.notOffered === true;

/** Our side broke on this run, so it says nothing about the test. */
export const oursBroke = (run: Judged | undefined) => run?.status === "error" && run.result?.blame === "ours";

export interface Counts {
  total: number;
  passed: number;
  failed: number;
  probable: number;
  needsInput: number;
  couldntRun: number;
  notRun: number;
  active: number;
}

export function count(reads: Read[]): Counts {
  const c: Counts = { total: reads.length, passed: 0, failed: 0, probable: 0, needsInput: 0, couldntRun: 0, notRun: 0, active: 0 };
  for (const r of reads) {
    if (r.settled === "pass") c.passed++;
    else if (r.settled === "fail") c.failed++;
    else if (r.settled === "probable") c.probable++;
    else if (r.settled === "input") c.needsInput++;
    else if (r.settled === "error") c.couldntRun++;
    else if (r.settled === "never") c.notRun++;
    if (r.active) c.active++;
  }
  return c;
}

/** "Doesn't apply" leaves the denominators: the condition can't tell us anything here. */
export function applicable(reads: Read[]): Read[] {
  return reads.filter((r) => r.settled !== "skipped");
}

export interface SigningFlag {
  dangerous: number;
  check: number;
}

export function signingOf(verdicts: Verdict[]): SigningFlag {
  return { dangerous: verdicts.filter((v) => v === "dangerous").length, check: verdicts.filter((v) => v === "check").length };
}

export function addSigning(a: SigningFlag, b: SigningFlag): SigningFlag {
  return { dangerous: a.dangerous + b.dangerous, check: a.check + b.check };
}

/** One test, with its conditions and the signing verdicts of both. */
export interface TestInput {
  read: Read;
  conditions: Read[];
  signing: SigningFlag;
}

export interface AppRollup {
  /** Passed only when every test passed and no condition failed. Partly run has no status word. */
  status: "pass" | "fail" | "error" | "never" | "partial" | "untested";
  tests: Counts;
  /** Tests with no steps yet. They can't run, so they sit outside the denominators. */
  untested: number;
  conditionsFailed: number;
  signing: SigningFlag;
}

export function appRollup(tests: TestInput[], untested = 0): AppRollup {
  const c = count(tests.map((t) => t.read));
  const conditionsFailed = count(tests.flatMap((t) => t.conditions)).failed;
  const signing = tests.map((t) => t.signing).reduce(addSigning, { dangerous: 0, check: 0 });
  let status: AppRollup["status"];
  if (c.total === 0) status = "untested";
  else if (c.failed + c.probable > 0) status = "fail";
  else if (c.couldntRun + c.needsInput > 0) status = "error";
  else if (c.notRun === c.total) status = "never";
  else if (c.passed < c.total) status = "partial";
  else status = conditionsFailed > 0 ? "fail" : "pass";
  return { status, tests: c, untested, conditionsFailed, signing };
}

/** "2 of 3 tests passed, 1 failed · 1 not tested" */
export function appText(r: AppRollup): string {
  const c = r.tests;
  if (c.total === 0) return r.untested === 0 ? "No tests yet" : `${r.untested} not tested yet`;
  const parts = [`${c.passed} of ${c.total} ${c.total === 1 ? "test" : "tests"} passed`];
  parts.push(...problems(c));
  if (c.notRun > 0) parts.push(`${c.notRun} not run yet`);
  if (r.conditionsFailed > 0) parts.push(`${r.conditionsFailed} ${r.conditionsFailed === 1 ? "condition" : "conditions"} failed`);
  const text = parts.join(", ");
  return r.untested > 0 ? `${text} · ${r.untested} not tested yet` : text;
}

function problems(c: Counts): string[] {
  const parts: string[] = [];
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  if (c.probable > 0) parts.push(`${c.probable} probably failed`);
  if (c.needsInput > 0) parts.push(`${c.needsInput} ${c.needsInput === 1 ? "needs" : "need"} your input`);
  if (c.couldntRun > 0) parts.push(`${c.couldntRun} couldn't run`);
  return parts;
}

/** "5 of 6 passed, 1 failed, 1 couldn't run" */
export function countsText(c: Counts): string {
  const parts = [`${c.passed} of ${c.total} passed`];
  parts.push(...problems(c));
  if (c.notRun > 0) parts.push(`${c.notRun} not run yet`);
  return parts.join(", ");
}

/** "1 dangerous signature · 2 to check"; nothing when every signature looked consistent. */
export function signingText(s: SigningFlag): string | undefined {
  const parts: string[] = [];
  if (s.dangerous > 0) parts.push(`${s.dangerous} dangerous ${s.dangerous === 1 ? "signature" : "signatures"}`);
  if (s.check > 0) parts.push(`${s.check} ${s.check === 1 ? "signature" : "signatures"} to check`);
  return parts.length ? parts.join(" · ") : undefined;
}
