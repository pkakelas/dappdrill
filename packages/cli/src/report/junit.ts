import { edgeCaseInfo, describeStep, type Flow, type FlowRun, type Issue } from "@dappdrill/core";
import { isBrokenSeverity, type ReportInput } from "./health.js";

/**
 * JUnit XML: one suite per flow, one test case per edge case. A case fails when the
 * flow broke or a critical/high issue was found; medium/low issues go to system-out.
 */
export function renderJunit(report: ReportInput): string {
  const suites: string[] = [];
  let total = 0;
  let failures = 0;
  let errors = 0;
  let skipped = 0;
  let time = 0;

  const flowIds = [...new Set(report.runs.map((r) => r.flowId))];
  for (const flowId of flowIds) {
    const flow = report.flows.find((f) => f.id === flowId);
    const name = flow?.name ?? flowId;
    const runs = report.runs.filter((r) => r.flowId === flowId);
    const cases: string[] = [];
    const s = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
    for (const run of runs) {
      const issues = report.issues.filter((i) => i.runId === run.id);
      const secs = Math.max(0, (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000) || 0;
      s.tests++;
      s.time += secs;
      let body = "";
      const broken = issues.filter((i) => isBrokenSeverity(i.severity));
      if (run.status === "skipped") {
        s.skipped++;
        body = `<skipped message="${esc(run.reason ?? "Not applicable")}"/>`;
      } else if (run.status === "error") {
        s.errors++;
        body = `<error message="${esc(run.reason ?? "DappDrill could not run this flow")}">${esc(failureText(run, issues, flow))}</error>`;
      } else if (run.status === "fail" || broken.length > 0) {
        s.failures++;
        const message = broken[0]?.title ?? run.reason ?? "Flow broke";
        body = `<failure message="${esc(message)}" type="${run.status === "fail" ? "broken" : broken[0]!.severity}">${esc(failureText(run, issues, flow))}</failure>`;
      }
      const minor = issues.filter((i) => !isBrokenSeverity(i.severity));
      if (minor.length > 0) body += `<system-out>${esc(minor.map((i) => `[${i.severity}] ${i.title}: ${i.summary}`).join("\n"))}</system-out>`;
      cases.push(
        `    <testcase classname="dappdrill.${esc(name)}" name="${esc(edgeCaseInfo(run.edgeCase).label)}" time="${secs.toFixed(3)}"${body ? `>${body}</testcase>` : "/>"}`,
      );
    }
    total += s.tests;
    failures += s.failures;
    errors += s.errors;
    skipped += s.skipped;
    time += s.time;
    suites.push(
      `  <testsuite name="${esc(name)}" tests="${s.tests}" failures="${s.failures}" errors="${s.errors}" skipped="${s.skipped}" time="${s.time.toFixed(3)}">\n${cases.join("\n")}\n  </testsuite>`,
    );
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="dappdrill" tests="${total}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${time.toFixed(3)}">`,
    ...suites,
    `</testsuites>`,
    "",
  ].join("\n");
}

function failureText(run: FlowRun, issues: Issue[], flow?: Flow): string {
  const lines: string[] = [];
  if (run.reason) lines.push(run.reason);
  const failed = run.steps.find((s) => s.status === "fail");
  if (failed) {
    const step = flow?.steps[failed.index];
    lines.push(`Step ${failed.index + 1}${step ? ` (${describeStep(step)})` : ""}: ${failed.error ?? "failed"}`);
  }
  for (const i of issues) lines.push(`[${i.severity}] ${i.title}: ${i.summary}`);
  return lines.join("\n");
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 doesn't allow.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}
