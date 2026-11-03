import {
  CATEGORY_LABEL,
  VERDICT_LABEL,
  edgeCaseInfo,
  formatDuration,
  type EdgeCaseId,
  type Issue,
  type Severity,
  type Verdict,
} from "@dappdrill/core";
import { blockedLine, healthLine, plural, runLabel, sortIssues, type ReportInput } from "./health.js";

const SEVERITY_HEADING: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const VERDICT_ORDER: Record<Verdict, number> = { dangerous: 0, check: 1, consistent: 2 };

export interface MarkdownOptions {
  /** Defaults to "DappDrill report". */
  title?: string;
  /** Link to the full report (web app, CI artifacts). */
  link?: string;
}

/** Plain Markdown: health line, issues by severity, the flow × edge-case matrix, signing verdicts. */
export function renderMarkdown(report: ReportInput, options: MarkdownOptions = {}): string {
  const out: string[] = [];
  const flowName = (id?: string) => report.flows.find((f) => f.id === id)?.name ?? "";
  const took = Date.parse(report.finishedAt) - Date.parse(report.startedAt);

  out.push(`# ${options.title ?? "DappDrill report"}`, "");
  out.push(`**${healthLine(report)}**`, "");
  const meta = [
    report.url,
    plural(report.flows.length, "flow"),
    plural(report.runs.length, "run"),
    Number.isFinite(took) ? formatDuration(took) : undefined,
    report.costUsd ? `$${report.costUsd.toFixed(2)}` : undefined,
  ].filter(Boolean);
  out.push(meta.join(" · "));
  if (report.stoppedEarly) out.push("", "Stopped early: results are partial.");
  if (report.blocked) out.push("", `${blockedLine(report.blocked)}`);
  if (options.link) out.push("", `Full report: ${options.link}`);

  // Issues
  if (report.issues.length > 0) {
    out.push("", "## Issues");
    let current: Severity | undefined;
    for (const issue of sortIssues(report.issues)) {
      if (issue.severity !== current) {
        current = issue.severity;
        out.push("", `### ${SEVERITY_HEADING[current]}`, "");
      }
      out.push(`- **${issue.title}** (${issueContext(issue, flowName)})`);
      out.push(`  ${oneLine(issue.summary)}`);
      if (issue.expected || issue.actual) {
        out.push(`  Expected: ${oneLine(issue.expected ?? "-")} Actual: ${oneLine(issue.actual ?? "-")}`);
      }
    }
  }

  // Matrix
  const edgeCases = [...new Set(report.runs.map((r) => r.edgeCase))];
  const flowIds = [...new Set(report.runs.map((r) => r.flowId))];
  if (flowIds.length > 0) {
    out.push("", "## Flows", "");
    out.push(row(["Flow", ...edgeCases.map((e) => edgeCaseInfo(e).label)]));
    out.push(row(["---", ...edgeCases.map(() => "---")]));
    for (const flowId of flowIds) {
      const cells = edgeCases.map((e: EdgeCaseId) => {
        const run = report.runs.filter((r) => r.flowId === flowId && r.edgeCase === e).at(-1);
        return run ? runLabel(run, report.issues) : "";
      });
      out.push(row([flowName(flowId) || flowId, ...cells]));
    }
  }

  // Signing
  if (report.signingReviews.length > 0) {
    out.push("", "## Signing requests", "");
    out.push(row(["Verdict", "Request", "Flow", "Since baseline"]));
    out.push(row(["---", "---", "---", "---"]));
    const reviews = [...report.signingReviews].sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]);
    for (const r of reviews) {
      const since = !r.baseline ? "New" : r.baseline.changes.length === 0 ? "Unchanged" : r.baseline.changes.map((c) => `${c.field}: ${c.before} → ${c.after}`).join("; ");
      out.push(row([VERDICT_LABEL[r.verdict], r.title, flowName(r.flowId), since]));
    }
  }

  out.push("");
  return out.join("\n");
}

function issueContext(issue: Issue, flowName: (id?: string) => string): string {
  return [CATEGORY_LABEL[issue.category], issue.flowName ?? flowName(issue.flowId), issue.edgeCase && edgeCaseInfo(issue.edgeCase).label, issue.unverified && "unverified"]
    .filter(Boolean)
    .join(" · ");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function row(cells: string[]): string {
  return `| ${cells.map((c) => oneLine(c).replace(/\|/g, "\\|")).join(" | ")} |`;
}
