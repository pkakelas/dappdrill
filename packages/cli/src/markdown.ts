import type { TestOutcome } from "@dappdrill/engine";
import type { TestsFile } from "./files.js";

/** A short summary for a PR comment or a CI job summary: failures first, passes folded away. */
export function renderMarkdown(tests: TestsFile, outcomes: TestOutcome[]): string {
  const byId = new Map(outcomes.map((o) => [o.testId, o]));
  const ran = tests.flows.flatMap((f) => f.tests.filter((t) => byId.has(t.id)).map((t) => ({ flow: f.name, test: t, o: byId.get(t.id)! })));
  const failed = ran.filter((r) => r.o.status === "fail" || r.o.status === "error");
  const passed = ran.filter((r) => r.o.status === "pass");
  const lines = [failed.length ? `**${failed.length} of ${ran.length} tests failed** on ${tests.url}` : `**All ${passed.length} tests passed** on ${tests.url}`, ""];
  for (const r of failed) lines.push(`- **${r.flow} · ${r.test.name}**: ${r.o.result.failure ?? (r.o.status === "error" ? "DappDrill couldn't run it." : "Failed.")}`);
  if (failed.length && passed.length) lines.push("");
  if (passed.length) lines.push(`<details><summary>${passed.length} passed</summary>`, "", ...passed.map((r) => `- ${r.flow} · ${r.test.name}`), "", "</details>");
  return `${lines.join("\n")}\n`;
}
