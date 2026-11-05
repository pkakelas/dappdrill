/**
 * Status rollups, computed at display time from the latest results. Nothing here is stored.
 *
 * A test's read is its latest finished result; a run in progress shows beside it and never
 * erases it. A flow reads from its tests only (conditions are reported separately), an app
 * from its flows. Signing verdicts are a flag next to the status, never part of it.
 */
import type { TestRunStatus } from "./test.js";
import type { Verdict } from "./signing.js";

/** What a test (or condition) shows: the latest finished result, plus whatever is in progress. */
export type Settled = "pass" | "fail" | "error" | "skipped" | "never";
export type Active = "queued" | "running";
export interface Read {
  settled: Settled;
  active?: Active;
}

export const SETTLED_LABEL: Record<Settled, string> = {
  pass: "Passed",
  fail: "Failed",
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

export interface Counts {
  total: number;
  passed: number;
  failed: number;
  couldntRun: number;
  notRun: number;
  active: number;
}

export function count(reads: Read[]): Counts {
  const c: Counts = { total: reads.length, passed: 0, failed: 0, couldntRun: 0, notRun: 0, active: 0 };
  for (const r of reads) {
    if (r.settled === "pass") c.passed++;
    else if (r.settled === "fail") c.failed++;
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

/** One tested thing inside a flow, with its conditions and signing verdicts. */
export interface FlowTestInput {
  read: Read;
  conditions: Read[];
  signing: SigningFlag;
}

/**
 * The flow's main read is about its tests only. A partly run flow has no status word, just
 * counts, so a dashboard never says Passed about work that didn't happen.
 */
export type FlowStatus = "pass" | "fail" | "error" | "never" | "partial" | "untested";

export interface FlowRollup {
  status: FlowStatus;
  tests: Counts;
  /** Over the conditions that apply; `added` is every condition row, applicable or not. */
  conditions: Counts & { added: number };
  signing: SigningFlag;
  active: boolean;
}

export function flowRollup(tests: FlowTestInput[]): FlowRollup {
  const reads = tests.map((t) => t.read);
  const c = count(reads);
  const conditionReads = tests.flatMap((t) => t.conditions);
  const cond = { ...count(applicable(conditionReads)), added: conditionReads.length };
  const signing = tests.map((t) => t.signing).reduce(addSigning, { dangerous: 0, check: 0 });
  const active = c.active > 0 || cond.active > 0;
  let status: FlowStatus;
  if (reads.length === 0) status = "untested";
  else if (c.failed > 0) status = "fail";
  else if (c.couldntRun > 0) status = "error";
  else if (c.notRun === reads.length) status = "never";
  else if (c.passed < reads.length) status = "partial";
  else status = "pass";
  return { status, tests: c, conditions: cond, signing, active };
}

export const FLOW_STATUS_LABEL: Record<Exclude<FlowStatus, "partial">, string> = {
  pass: "Passed",
  fail: "Failed",
  error: "Couldn't run",
  never: "Not run yet",
  untested: "Not tested",
};

/** "Passed", or for a partly run flow "1 of 3 passed". */
export function flowStatusText(r: FlowRollup): string {
  if (r.status === "partial") return `${r.tests.passed} of ${r.tests.total} passed`;
  return FLOW_STATUS_LABEL[r.status];
}

/** "5 of 6 passed, 1 failed, 1 couldn't run", "not added", or "2 not run yet". */
export function conditionsText(r: FlowRollup): string {
  if (r.conditions.added === 0) return "not added";
  if (r.conditions.total === 0) return `${r.conditions.added === 1 ? "doesn't" : "none"} apply`;
  return countsText(r.conditions);
}

export function countsText(c: Counts): string {
  const parts = [`${c.passed} of ${c.total} passed`];
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  if (c.couldntRun > 0) parts.push(`${c.couldntRun} couldn't run`);
  if (c.notRun > 0) parts.push(`${c.notRun} not run yet`);
  return parts.join(", ");
}

export interface AppRollup {
  /** Passed only when every tested flow passed and no condition failed. */
  status: "pass" | "fail" | "error" | "never" | "partial" | "untested";
  flows: { total: number; tested: number; untested: number; passed: number; failed: number; couldntRun: number; notRun: number; partial: number };
  conditionsFailed: number;
  signing: SigningFlag;
  active: boolean;
}

export function appRollup(flows: FlowRollup[]): AppRollup {
  const f = { total: flows.length, tested: 0, untested: 0, passed: 0, failed: 0, couldntRun: 0, notRun: 0, partial: 0 };
  let conditionsFailed = 0;
  let signing: SigningFlag = { dangerous: 0, check: 0 };
  let active = false;
  for (const r of flows) {
    if (r.status === "untested") f.untested++;
    else f.tested++;
    if (r.status === "pass") f.passed++;
    else if (r.status === "fail") f.failed++;
    else if (r.status === "error") f.couldntRun++;
    else if (r.status === "never") f.notRun++;
    else if (r.status === "partial") f.partial++;
    conditionsFailed += r.conditions.failed;
    signing = addSigning(signing, r.signing);
    active ||= r.active;
  }
  let status: AppRollup["status"];
  if (f.tested === 0) status = "untested";
  else if (f.failed > 0) status = "fail";
  else if (f.couldntRun > 0) status = "error";
  else if (f.notRun === f.tested) status = "never";
  else if (f.notRun > 0 || f.partial > 0) status = "partial";
  else status = conditionsFailed > 0 ? "fail" : "pass";
  return { status, flows: f, conditionsFailed, signing, active };
}

/** "2 of 3 flows passed, 1 failed · 1 not tested" */
export function appText(r: AppRollup): string {
  const f = r.flows;
  if (f.tested === 0) return f.total === 0 ? "No flows yet" : `${f.total} ${f.total === 1 ? "flow" : "flows"} found, none tested`;
  const parts = [`${f.passed} of ${f.tested} ${f.tested === 1 ? "flow" : "flows"} passed`];
  if (f.failed > 0) parts.push(`${f.failed} failed`);
  if (f.couldntRun > 0) parts.push(`${f.couldntRun} couldn't run`);
  if (f.partial > 0) parts.push(`${f.partial} partly run`);
  if (f.notRun > 0) parts.push(`${f.notRun} not run yet`);
  if (r.conditionsFailed > 0) parts.push(`${r.conditionsFailed} ${r.conditionsFailed === 1 ? "condition" : "conditions"} failed`);
  let text = parts.join(", ");
  if (f.untested > 0) text += ` · ${f.untested} not tested`;
  return text;
}

/** "1 dangerous signature · 2 to check"; nothing when every signature looked consistent. */
export function signingText(s: SigningFlag): string | undefined {
  const parts: string[] = [];
  if (s.dangerous > 0) parts.push(`${s.dangerous} dangerous ${s.dangerous === 1 ? "signature" : "signatures"}`);
  if (s.check > 0) parts.push(`${s.check} ${s.check === 1 ? "signature" : "signatures"} to check`);
  return parts.length ? parts.join(" · ") : undefined;
}
