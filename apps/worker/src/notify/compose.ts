import { SEVERITY_ORDER, edgeCaseInfo, type EdgeCaseId, type Issue } from "@dappdrill/core";

export interface Regression {
  flowName: string;
  edgeCase: EdgeCaseId;
}

export interface Alert {
  title: string;
  /** Short plain lines, one per problem (capped). */
  lines: string[];
  /** "1 critical, 1 high · 1 flow broke" */
  counts: string;
  link: string;
}

const MAX_LINES = 6;
const SEVERITY_WORD = { critical: "Critical", high: "High", medium: "Medium", low: "Low" } as const;

/** Null when there is nothing worth interrupting someone for. */
export function composeAlert(input: {
  appName: string;
  what: "scan" | "scheduled run" | "run";
  newIssues: Issue[];
  regressions: Regression[];
  link: string;
}): Alert | null {
  const { newIssues, regressions } = input;
  if (newIssues.length === 0 && regressions.length === 0) return null;

  const problems = newIssues.length + regressions.length;
  const title = `${input.appName}: ${problems === 1 ? "1 new problem" : `${problems} new problems`} in the latest ${input.what}`;

  const lines = [
    ...[...newIssues]
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      .map((i) => `${SEVERITY_WORD[i.severity]}: ${i.title}${i.flowName ? ` (${i.flowName})` : ""}`),
    ...regressions.map((r) => `Broke: ${r.flowName} · ${edgeCaseInfo(r.edgeCase).label} (passed before)`),
  ];
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`and ${lines.length - MAX_LINES} more`);

  const bySeverity = (["critical", "high"] as const)
    .map((s) => [s, newIssues.filter((i) => i.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);
  const counts = [bySeverity.join(", "), regressions.length ? `${regressions.length} ${regressions.length === 1 ? "flow" : "flows"} broke` : ""]
    .filter(Boolean)
    .join(" · ");

  return { title, lines: shown, counts, link: input.link };
}

export function alertText(alert: Alert): string {
  return [alert.title, "", ...alert.lines.map((l) => `- ${l}`), "", alert.counts, alert.link].join("\n");
}

export function slackPayload(alert: Alert): unknown {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    text: alert.title,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${esc(alert.title)}*` } },
      { type: "section", text: { type: "mrkdwn", text: alert.lines.map((l) => `• ${esc(l)}`).join("\n") } },
      { type: "context", elements: [{ type: "mrkdwn", text: esc(alert.counts) }] },
      { type: "section", text: { type: "mrkdwn", text: `<${alert.link}|Open the report>` } },
    ],
  };
}
