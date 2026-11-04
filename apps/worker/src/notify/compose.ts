export interface Regression {
  testName: string;
  flowName: string;
  /** What went wrong, one plain sentence. */
  failure?: string;
}

export interface Alert {
  title: string;
  /** Short plain lines, one per test (capped). */
  lines: string[];
  link: string;
}

const MAX_LINES = 6;

/** Null when nothing broke. */
export function composeAlert(input: { appName: string; regressions: Regression[]; link: string }): Alert | null {
  const { regressions } = input;
  if (regressions.length === 0) return null;
  const title = `${input.appName}: ${regressions.length === 1 ? "a test" : `${regressions.length} tests`} stopped passing`;
  const lines = regressions.map((r) => `${r.flowName} · ${r.testName}${r.failure ? `: ${r.failure}` : ""}`);
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`and ${lines.length - MAX_LINES} more`);
  return { title, lines: shown, link: input.link };
}

export function alertText(alert: Alert): string {
  return [alert.title, "", ...alert.lines.map((l) => `- ${l}`), "", alert.link].join("\n");
}

export function slackPayload(alert: Alert): unknown {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    text: alert.title,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${esc(alert.title)}*` } },
      { type: "section", text: { type: "mrkdwn", text: alert.lines.map((l) => `• ${esc(l)}`).join("\n") } },
      { type: "section", text: { type: "mrkdwn", text: `<${alert.link}|Open the tests>` } },
    ],
  };
}
