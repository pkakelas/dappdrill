import type { TestOutcome } from "@dappdrill/engine";
import { testLabels, type TestsFile } from "./files.js";
import { dangerous } from "./outcomes.js";

/**
 * JUnit XML: one suite per flow, one case per test that ran. CI keeps a case's history by its
 * name. JUnit has one word per case, so a Dangerous signature on a passing test is a failure.
 */
export function renderJunit(tests: TestsFile, outcomes: TestOutcome[], seconds: Map<string, number> = new Map()): string {
  const byId = new Map(outcomes.map((o) => [o.testId, o]));
  const labels = testLabels(tests);
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const suites = tests.flows.flatMap((flow) => {
    const ran = flow.tests.filter((t) => byId.has(t.id));
    if (ran.length === 0) return [];
    const s = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
    const cases = ran.map((t) => {
      const o = byId.get(t.id)!;
      const time = seconds.get(t.id) ?? 0;
      s.tests++;
      s.time += time;
      const reason = o.status === "pass" ? undefined : (o.result.failure ?? o.result.verdict?.reason);
      const flags = dangerous(o).map((r) => `Dangerous signature: ${r.title}`);
      const message = esc([reason, ...flags].filter(Boolean).join(" "));
      let body = "";
      if (o.status === "fail" || flags.length > 0) {
        s.failures++;
        body = `<failure message="${message}"/>`;
      } else if (o.status === "error") {
        s.errors++;
        body = `<error message="${message}"/>`;
      } else if (o.status !== "pass") {
        s.skipped++;
        body = `<skipped message="${o.status}"/>`;
      }
      return `    <testcase classname="${esc(flow.name)}" name="${esc(labels.get(t.id)!)}" time="${time}">${body}</testcase>`;
    });
    for (const k of ["tests", "failures", "errors", "skipped"] as const) totals[k] += s[k];
    return [
      `  <testsuite name="${esc(flow.name)}" tests="${s.tests}" failures="${s.failures}" errors="${s.errors}" skipped="${s.skipped}" time="${s.time}">\n${cases.join("\n")}\n  </testsuite>`,
    ];
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="DappDrill" tests="${totals.tests}" failures="${totals.failures}" errors="${totals.errors}" skipped="${totals.skipped}">\n${suites.join("\n")}\n</testsuites>\n`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
