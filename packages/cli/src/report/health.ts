import {
  HEALTH_LABEL,
  SEVERITY_ORDER,
  healthOfIssues,
  type Blocked,
  type Flow,
  type FlowRun,
  type Health,
  type Issue,
  type Severity,
  type SigningReview,
  type Stalled,
} from "@dappdrill/core";
export { blockedLine, stalledLine } from "@dappdrill/core";

/** What every report renderer needs. A ScanReport fits, and so does a replay's result. */
export interface ReportInput {
  url: string;
  startedAt: string;
  finishedAt: string;
  flows: Flow[];
  runs: FlowRun[];
  issues: Issue[];
  signingReviews: SigningReview[];
  costUsd?: number;
  stoppedEarly?: boolean;
  blocked?: Blocked;
  stalled?: Stalled;
}

/** Issue health, plus Broken when a flow itself broke (or we couldn't run it). */
export function reportHealth(report: Pick<ReportInput, "issues" | "runs">): Health {
  if (report.runs.some((r) => r.status === "fail" || r.status === "error")) return "broken";
  return healthOfIssues(report.issues);
}

export type FailOn = "broken" | "review" | "never";

/** 1 when the report is at least as bad as `failOn`, else 0. */
export function exitCodeFor(health: Health, failOn: FailOn): number {
  if (failOn === "never") return 0;
  if (failOn === "review") return health === "ok" ? 0 : 1;
  return health === "broken" ? 1 : 0;
}

export function isBrokenSeverity(s: Severity): boolean {
  return s === "critical" || s === "high";
}

/** One cell of the matrix: Broken / Review / OK, or a dash when not applicable. */
export function runLabel(run: FlowRun, issues: Issue[]): string {
  const mine = issues.filter((i) => i.runId === run.id);
  switch (run.status) {
    case "pass":
      return HEALTH_LABEL.ok;
    case "issue":
      return mine.some((i) => isBrokenSeverity(i.severity)) ? HEALTH_LABEL.broken : HEALTH_LABEL.review;
    case "fail":
      return HEALTH_LABEL.broken;
    case "error":
      return "Error";
    case "skipped":
      return "–";
  }
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) out[i.severity]++;
  return out;
}

/** "Broken: 2 problems need fixing (1 critical, 1 high). 3 more to review." */
export function healthLine(report: Pick<ReportInput, "issues" | "runs">): string {
  if (report.runs.length === 0 && report.issues.length === 0) return "Nothing tested: no flows were found or run.";
  const health = reportHealth(report);
  const c = countBySeverity(report.issues);
  const broken = c.critical + c.high;
  const review = c.medium + c.low;
  // Runs that broke without a critical/high issue explaining it.
  const brokenIds = new Set(report.issues.filter((i) => isBrokenSeverity(i.severity)).map((i) => i.id));
  const brokenRuns = report.runs.filter((r) => (r.status === "fail" || r.status === "error") && !r.issueIds.some((id) => brokenIds.has(id))).length;
  const parts: string[] = [];
  if (broken > 0) {
    const detail = [c.critical && `${c.critical} critical`, c.high && `${c.high} high`].filter(Boolean).join(", ");
    parts.push(`${plural(broken, "problem")} to fix (${detail}).`);
  }
  if (brokenRuns > 0) parts.push(`${plural(brokenRuns, "run")}${broken > 0 ? " also" : ""} broke.`);
  if (review > 0) parts.push(`${review} ${broken > 0 ? "more " : ""}to review.`);
  if (parts.length === 0) parts.push("No problems found.");
  return `${HEALTH_LABEL[health]}: ${parts.join(" ")}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
