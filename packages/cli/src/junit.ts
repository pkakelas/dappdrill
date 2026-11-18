import type { TestResult } from "@dappdrill/core";
import type { TestsFile } from "./files.js";
import { dangerous, reviewLine, whyNot } from "./outcomes.js";

/**
 * JUnit XML: one suite for the app, one case per test that ran. CI keeps a case's history by its
 * name. JUnit has one word per case, so a Dangerous signature on a passing test is a failure, and a
 * test that couldn't be verified is an error: it didn't fail, and nobody can say it passed. One that
 * needs repairing says so in the error's message.
 */
export function renderJunit(file: TestsFile, results: TestResult[]): string {
  const byId = new Map(results.map((r) => [r.testId, r]));
  const suite = esc(new URL(file.url).host);
  const s = { tests: 0, failures: 0, errors: 0, time: 0 };
  const cases = file.tests.filter((t) => byId.has(t.id)).map((t) => {
    const r = byId.get(t.id)!;
    const time = Math.round(r.durationMs / 1000);
    s.tests++;
    s.time += time;
    const flags = dangerous(r).map((d) => `Dangerous signature: ${d.title}`);
    const message = esc([r.outcome === "passed" ? undefined : whyNot(r), ...flags].filter(Boolean).join(" "));
    let body = "";
    if (r.outcome === "failed" || flags.length > 0) {
      s.failures++;
      body = `<failure message="${message}"/>`;
    } else if (r.outcome === "unverified") {
      s.errors++;
      body = `<error message="${message}"/>`;
    }
    const reviews = r.signingReviews.map(reviewLine);
    if (reviews.length) body += `<system-out>${esc(reviews.join("\n"))}</system-out>`;
    return `    <testcase classname="${suite}" name="${esc(t.name)}" time="${time}">${body}</testcase>`;
  });
  const counts = `tests="${s.tests}" failures="${s.failures}" errors="${s.errors}" skipped="0"`;
  const body = cases.length ? `  <testsuite name="${suite}" ${counts} time="${s.time}">\n${cases.join("\n")}\n  </testsuite>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="DappDrill" ${counts}>\n${body}</testsuites>\n`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
