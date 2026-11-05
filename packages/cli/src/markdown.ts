import type { TestOutcome } from "@dappdrill/engine";
import type { TestsFile } from "./files.js";
import { DANGEROUS_FAILS, distinctReviews, reviewLine, reviewsLine, tally, tallyLine } from "./outcomes.js";

/** A short summary for a PR comment or a CI job summary: failures first, passes folded away. */
export function renderMarkdown(tests: TestsFile, outcomes: TestOutcome[], total = outcomes.length, failOnDangerous = false): string {
  const byId = new Map(outcomes.map((o) => [o.testId, o]));
  const ran = tests.flows.flatMap((f) => f.tests.filter((t) => byId.has(t.id)).map((t) => ({ name: `${f.name} · ${t.name}`, o: byId.get(t.id)! })));
  const having = (s: TestOutcome["status"]) => ran.filter((r) => r.o.status === s);
  const passed = having("pass");
  const t = tally(outcomes, total);

  const headline = t.passed + t.failed + t.couldntRun === 0 ? "No tests ran" : t.passed === total ? `All ${t.passed} tests passed` : tallyLine(t);
  const lines = [`**${headline}** on ${tests.url}`, ""];
  for (const r of having("fail")) lines.push(`- **${r.name}**: ${r.o.result.failure ?? "Failed."}`);
  for (const r of having("error")) lines.push(`- **${r.name}**: Couldn't run. ${r.o.result.failure ?? ""}`.trimEnd());
  for (const r of [...having("skipped"), ...having("stopped")]) lines.push(`- ${r.name}: Not run. ${r.o.result.failure ?? ""}`.trimEnd());
  if (lines.length > 2) lines.push("");

  const reviews = distinctReviews(ran.flatMap((r) => r.o.result.signingReviews.map((review) => ({ review, name: r.name }))));
  const flagged = reviews.filter((r) => r.review.verdict !== "consistent");
  const line = reviewsLine(reviews.map((r) => r.review));
  if (failOnDangerous && reviews.some((r) => r.review.verdict === "dangerous")) lines.push(`**${DANGEROUS_FAILS}**`, "");
  if (line) lines.push(line, "", ...flagged.map((r) => `- ${reviewLine(r.review)} (${r.name})`));
  if (flagged.length) lines.push("");

  if (passed.length) lines.push(`<details><summary>${passed.length} passed</summary>`, "", ...passed.map((r) => `- ${r.name}`), "", "</details>");
  return `${lines.join("\n").trimEnd()}\n`;
}
