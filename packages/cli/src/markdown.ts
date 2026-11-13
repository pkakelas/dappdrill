import type { TestResult } from "@dappdrill/core";
import type { TestsFile } from "./files.js";
import { dangerous, distinctReviews, reviewLine, reviewsLine, summaryText } from "./outcomes.js";

/** A short summary for a PR comment or a CI job summary: problems first, passes folded away. `asked` is the tests the run was for. */
export function renderMarkdown(file: TestsFile, results: TestResult[], asked: string[]): string {
  const byId = new Map(results.map((r) => [r.testId, r]));
  const tests = file.tests.filter((t) => asked.includes(t.id));
  const ran = tests.flatMap((t) => (byId.has(t.id) ? [{ label: t.name, r: byId.get(t.id)! }] : []));
  const notRun = tests.filter((t) => !byId.has(t.id));
  const passed = ran.filter(({ r }) => r.outcome === "passed");
  const problems = [
    ...ran.flatMap(({ label, r }) => [
      ...dangerous(r).map((d) => `- **${label}**: Dangerous signature: ${d.title}`),
      ...(r.outcome === "failed" ? [`- **${label}**: ${r.reason ?? "Failed."}`] : []),
      ...(r.outcome === "unverified" ? [`- **${label}**: Couldn't verify. ${r.reason ?? ""}`.trimEnd()] : []),
    ]),
    ...notRun.map((t) => `- ${t.name}: Not run.`),
  ];
  const clean = ran.length > 0 && notRun.length === 0 && passed.length === ran.length && ran.every(({ r }) => r.signingReviews.every((s) => s.verdict === "consistent"));
  const headline = ran.length === 0 ? "No tests ran" : clean ? (passed.length === 1 ? "The test passed" : `All ${passed.length} tests passed`) : summaryText(results, tests.length);
  const lines = [`**${headline}** on ${file.url}`, ""];
  lines.push(...problems);
  if (problems.length) lines.push("");

  const reviews = distinctReviews(ran.flatMap(({ label, r }) => r.signingReviews.map((review) => ({ review, label }))));
  const toCheck = reviews.filter((r) => r.review.verdict === "check");
  const line = reviewsLine(reviews.map((r) => r.review));
  if (line) lines.push(line, "", ...toCheck.map((r) => `- ${reviewLine(r.review)} (${r.label})`));
  if (toCheck.length) lines.push("");

  if (passed.length) lines.push(`<details><summary>${passed.length} passed</summary>`, "", ...passed.map((r) => `- ${r.label}`), "", "</details>");
  return `${lines.join("\n").trimEnd()}\n`;
}
