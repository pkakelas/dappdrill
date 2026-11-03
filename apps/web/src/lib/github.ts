import { chainName, type Issue, type SigningReview } from "@dappdrill/core";

export function reviewMarkdown(r: SigningReview, link?: string): string {
  const lines = [
    `**${r.title}** — DappDrill verdict: ${r.verdict === "dangerous" ? "Dangerous" : r.verdict === "check" ? "Check this" : "Looks consistent"}`,
    "",
    r.summary,
    "",
    `- Chain: ${chainName(r.chainId)} (${r.chainId})`,
    `- Method: \`${r.method}\``,
  ];
  if (r.ui.buttonLabel) lines.push(`- The button said: “${r.ui.buttonLabel}”`);
  if (r.decoded.signature || r.decoded.functionName) lines.push(`- The wallet was asked for: \`${r.decoded.signature ?? r.decoded.functionName}\` on \`${r.decoded.to ?? "?"}\``);
  for (const a of r.decoded.args) lines.push(`  - ${a.name}: ${a.display ?? a.value}`);
  const bad = r.checks.filter((c) => c.status === "fail" || c.status === "warn");
  if (bad.length) {
    lines.push("", "### Checks");
    for (const c of bad) lines.push(`- **${c.status === "fail" ? "Failed" : "Warning"}** ${c.label}: ${c.detail}${c.unverified ? " _(unverified)_" : ""}`);
  }
  lines.push("", "### Why", r.explanation);
  if (r.advice) lines.push("", "### What to change", r.advice);
  if (link) lines.push("", `[Open in DappDrill](${link})`);
  return lines.join("\n");
}

export function issueMarkdown(i: Issue, link?: string): string {
  const lines = [`**${i.title}** (${i.severity})`, "", i.summary];
  if (i.stepsToReproduce.length) {
    lines.push("", "### Steps to reproduce");
    // The engine numbers the flow's steps itself ("1. Connect") and leaves setup lines bare.
    const numbered = i.stepsToReproduce.some((s) => /^\d+\.\s/.test(s));
    i.stepsToReproduce.forEach((s, n) => lines.push(numbered ? s : `${n + 1}. ${s}`));
  }
  if (i.expected) lines.push("", `**Expected:** ${i.expected}`);
  if (i.actual) lines.push(`**Actual:** ${i.actual}`);
  if (link) lines.push("", `[Open in DappDrill](${link})`);
  return lines.join("\n");
}

export function githubNewIssueUrl(repo: string, title: string, body: string): string {
  const q = new URLSearchParams({ title, body: body.length > 6000 ? body.slice(0, 6000) + "\n…" : body });
  return `https://github.com/${repo}/issues/new?${q}`;
}
