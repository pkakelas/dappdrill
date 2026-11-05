import type { TestOutcome } from "@dappdrill/engine";
import { testLabels, type TestsFile } from "./files.js";
import { dangerous, reviewLine } from "./outcomes.js";

/**
 * JUnit XML: one suite for the app, one case per test that ran. CI keeps a case's history by its
 * name. JUnit has one word per case, so a Dangerous signature on a passing test is a failure.
 */
export function renderJunit(file: TestsFile, outcomes: TestOutcome[], seconds: Map<string, number> = new Map()): string {
  const byId = new Map(outcomes.map((o) => [o.testId, o]));
  const labels = testLabels(file);
  const suite = esc(new URL(file.url).host);
  const s = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  const cases = file.tests.filter((t) => byId.has(t.id)).map((t) => {
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
      body = `<skipped message="${message || o.status}"/>`;
    }
    const reviews = o.result.signingReviews.map(reviewLine);
    if (reviews.length) body += `<system-out>${esc(reviews.join("\n"))}</system-out>`;
    return `    <testcase classname="${suite}" name="${esc(labels.get(t.id)!)}" time="${time}">${body}</testcase>`;
  });
  const counts = `tests="${s.tests}" failures="${s.failures}" errors="${s.errors}" skipped="${s.skipped}"`;
  const body = cases.length ? `  <testsuite name="${suite}" ${counts} time="${s.time}">\n${cases.join("\n")}\n  </testsuite>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="DappDrill" ${counts}>\n${body}</testsuites>\n`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
