import type { TestOutcome } from "@dappdrill/engine";
import { testLabels, type TestsFile } from "./files.js";
import { dangerous, distinctReviews, reviewLine, reviewsLine, summaryText } from "./outcomes.js";

/** A short summary for a PR comment or a CI job summary: problems first, passes folded away. */
export function renderMarkdown(file: TestsFile, outcomes: TestOutcome[]): string {
  const byId = new Map(outcomes.map((o) => [o.testId, o]));
  const labels = testLabels(file);
  const ran = file.tests.filter((t) => byId.has(t.id)).map((t) => ({ label: labels.get(t.id)!, o: byId.get(t.id)! }));
  const passed = ran.filter((r) => r.o.status === "pass");
  const problems = ran.flatMap(({ label, o }) => [
    ...dangerous(o).map((r) => `- **${label}**: Dangerous signature: ${r.title}`),
    ...(o.status === "fail" ? [`- **${label}**: ${o.result.failure ?? "Failed."}`] : []),
    ...(o.status === "error" ? [`- **${label}**: Couldn't run. ${o.result.failure ?? ""}`.trimEnd()] : []),
    ...(o.status === "skipped" || o.status === "stopped" ? [`- ${label}: Not run. ${o.result.failure ?? ""}`.trimEnd()] : []),
  ]);
  const clean = ran.length > 0 && passed.length === ran.length && ran.every(({ o }) => o.result.signingReviews.every((r) => r.verdict === "consistent"));
  const none = ran.every(({ o }) => o.status === "skipped" || o.status === "stopped");
  const headline = none ? "No tests ran" : clean ? `All ${passed.length} tests passed` : summaryText(outcomes);
  const lines = [`**${headline}** on ${file.url}`, ""];
  lines.push(...problems);
  if (problems.length) lines.push("");

  const reviews = distinctReviews(ran.flatMap(({ label, o }) => o.result.signingReviews.map((review) => ({ review, label }))));
  const toCheck = reviews.filter((r) => r.review.verdict === "check");
  const line = reviewsLine(reviews.map((r) => r.review));
  if (line) lines.push(line, "", ...toCheck.map((r) => `- ${reviewLine(r.review)} (${r.label})`));
  if (toCheck.length) lines.push("");

  if (passed.length) lines.push(`<details><summary>${passed.length} passed</summary>`, "", ...passed.map((r) => `- ${r.label}`), "", "</details>");
  return `${lines.join("\n").trimEnd()}\n`;
}
