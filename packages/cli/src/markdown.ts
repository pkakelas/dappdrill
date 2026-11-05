import type { TestOutcome } from "@dappdrill/engine";
import { testLabels, type TestsFile } from "./files.js";
import { dangerous, summaryText } from "./outcomes.js";

/** A short summary for a PR comment or a CI job summary: problems first, passes folded away. */
export function renderMarkdown(tests: TestsFile, outcomes: TestOutcome[]): string {
  const byId = new Map(outcomes.map((o) => [o.testId, o]));
  const labels = testLabels(tests);
  const ran = tests.flows.flatMap((f) => f.tests.filter((t) => byId.has(t.id)).map((t) => ({ label: labels.get(t.id)!, o: byId.get(t.id)! })));
  const passed = ran.filter((r) => r.o.status === "pass");
  const problems = ran.flatMap(({ label, o }) => [
    ...dangerous(o).map((r) => `- **${label}**: Dangerous signature: ${r.title}`),
    ...(o.status === "fail" ? [`- **${label}**: ${o.result.failure ?? "Failed."}`] : []),
    ...(o.status === "error" ? [`- **${label}**: Couldn't run. ${o.result.failure ?? ""}`.trimEnd()] : []),
  ]);
  const clean = passed.length === ran.length && ran.every(({ o }) => o.result.signingReviews.every((r) => r.verdict === "consistent"));
  const lines = [clean ? `**All ${passed.length} tests passed** on ${tests.url}` : `**${summaryText(outcomes)}** on ${tests.url}`, ""];
  lines.push(...problems);
  if (problems.length && passed.length) lines.push("");
  if (passed.length) lines.push(`<details><summary>${passed.length} passed</summary>`, "", ...passed.map((r) => `- ${r.label}`), "", "</details>");
  return `${lines.join("\n")}\n`;
}
