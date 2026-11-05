import { fingerprint, type SigningReview } from "@dappdrill/core";

/** Where something happened: reads "Flow · Test · Condition". */
export interface Place {
  testName: string;
  flowName: string;
  /** Set for a condition row: the condition's name. */
  condition?: string;
}

export interface Regression extends Place {
  /** What went wrong, one plain sentence. */
  failure?: string;
}

export interface DangerousSignature extends Place {
  key: string;
  /** "Unlimited USDC approval to an unverified contract". */
  title: string;
  /** How many other tests in the batch asked for it too. */
  others: number;
}

export interface Alert {
  title: string;
  /** Short plain lines, one per test (capped). */
  lines: string[];
  link: string;
}

const MAX_LINES = 6;

/**
 * What makes two signatures the same one, across runs and tests. The review's `fingerprint`
 * can't: it differs between the agent and saved actions, and between a test and its
 * conditions, and it ignores the spender. Amounts stay out because quotes move between runs.
 */
export function signatureKey(r: SigningReview): string {
  const { decoded: d } = r;
  const addresses = [...r.approvals.map((a) => a.spender), ...d.args.filter((a) => a.type.startsWith("address")).map((a) => a.value)];
  return fingerprint(
    r.chainId,
    r.method,
    d.to?.toLowerCase(),
    d.signature ?? d.functionName ?? d.primaryType,
    String(d.domain?.verifyingContract ?? "").toLowerCase(),
    [...new Set(addresses.map((a) => a.toLowerCase()))].sort().join(","),
    r.approvals.some((a) => a.unlimited) ? "unlimited" : "",
  );
}

/**
 * The Dangerous signatures in a batch the team hasn't been told about, one per signature
 * however many tests asked for it. Named after a test rather than a condition when it can be.
 */
export function newDangerous(results: (Place & { reviews: SigningReview[] })[], told: Set<string>): DangerousSignature[] {
  const found = new Map<string, DangerousSignature>();
  for (const { reviews, ...place } of [...results].sort((a, b) => Number(!!a.condition) - Number(!!b.condition))) {
    const keys = new Set<string>();
    for (const r of reviews) {
      const key = signatureKey(r);
      if (r.verdict !== "dangerous" || told.has(key) || keys.has(key)) continue;
      keys.add(key);
      const seen = found.get(key);
      if (seen) seen.others++;
      else found.set(key, { ...place, key, title: r.title, others: 0 });
    }
  }
  return [...found.values()];
}

const placeText = (p: Place) => `${p.flowName} · ${p.testName}${p.condition ? ` · ${p.condition}` : ""}`;

function dangerousLine(d: DangerousSignature): string {
  const others = d.others ? ` (and ${d.others} other ${d.others === 1 ? "test" : "tests"})` : "";
  return `Dangerous signature in ${placeText(d)}${others}: ${d.title}`;
}

/** Null when there's nothing to tell. Dangerous signatures go first, so the line cap never hides one behind a regression. */
export function composeAlert(input: { appName: string; regressions: Regression[]; dangerous?: DangerousSignature[]; link: string }): Alert | null {
  const { regressions, dangerous = [] } = input;
  if (regressions.length === 0 && dangerous.length === 0) return null;
  const parts = [
    dangerous.length && (dangerous.length === 1 ? "a new dangerous signature" : `${dangerous.length} new dangerous signatures`),
    regressions.length && `${regressions.length === 1 ? "a test" : `${regressions.length} tests`} stopped passing`,
  ];
  const title = `${input.appName}: ${parts.filter(Boolean).join(", ")}`;
  const lines = [...dangerous.map(dangerousLine), ...regressions.map((r) => `${placeText(r)}${r.failure ? `: ${r.failure}` : ""}`)];
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
