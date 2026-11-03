/**
 * The verdict rules, in order. Deterministic: the same facts always give the
 * same verdict. Verdicts are "dangerous", "check" or "consistent" — never "safe".
 *
 *  dangerous  known-bad hit; an approval or permit to a wallet address or to an
 *             unverified / new contract; the UI doesn't match while an approval,
 *             native value or outgoing tokens are at stake (this covers "Sign in"
 *             buttons that are really permits or transfers).
 *  check      any other failing or warning check (unlimited approval, revert,
 *             baseline change, expectation mismatch…), or data we needed but
 *             couldn't confirm: the UI comparison, the blocklists, or — when value
 *             is at stake — the spender's source, age or the token.
 *  consistent everything else.
 */
import type { SigningCheck, Verdict } from "@dappdrill/core";
import { hasStake, outgoing, type Facts } from "./facts.js";
import { labelIntent } from "./ui-match.js";

export interface Decision {
  verdict: Verdict;
  /** Short bullets, most serious first: "Unlimited where the UI shows 250". */
  reasons: string[];
}

const NEEDS_STAKE_TO_MATTER = new Set<SigningCheck["id"]>(["verified-source", "contract-age", "token", "approval", "proxy"]);
const ALWAYS_MATTERS = new Set<SigningCheck["id"]>(["ui-match", "known-bad"]);

export function decideVerdict(facts: Facts, checks: SigningCheck[]): Decision {
  const byId = Object.fromEntries(checks.map((c) => [c.id, c])) as Record<SigningCheck["id"], SigningCheck | undefined>;
  const reasons: string[] = [];
  const stake = hasStake(facts);
  let dangerous = false;

  if (byId["known-bad"]?.status === "fail") {
    dangerous = true;
    reasons.push("On a known-bad list");
  }
  if (byId.approval?.status === "fail") {
    dangerous = true;
    reasons.push(approvalReason(facts));
  }
  if (byId["ui-match"]?.status === "fail" && stake) {
    dangerous = true;
    reasons.push(uiReason(facts, byId["ui-match"]));
  }
  const intent = labelIntent(facts.input.ui.buttonLabel);
  if ((intent === "signin" || intent === "claim") && (facts.approvals.length || outgoing(facts).length) && !reasons.some((r) => r.startsWith("The button says"))) {
    dangerous = true;
    reasons.push(`The button says “${facts.input.ui.buttonLabel}” but ${facts.approvals.length ? "the request grants an allowance" : "tokens leave the wallet"}`);
  }
  if (dangerous) {
    reasons.push(...secondary(checks, reasons));
    return { verdict: "dangerous", reasons };
  }

  for (const c of checks) {
    if (c.status === "fail" || c.status === "warn") reasons.push(short(c));
  }
  for (const c of checks) {
    if (c.status !== "unverified") continue;
    if (ALWAYS_MATTERS.has(c.id) || (stake && NEEDS_STAKE_TO_MATTER.has(c.id))) reasons.push(short(c));
  }
  if (facts.parsed.kind === "unknown") reasons.push("The request couldn't be decoded");
  return { verdict: reasons.length ? "check" : "consistent", reasons };
}

function approvalReason(facts: Facts): string {
  const a = facts.approvals[0];
  const spender = facts.spenders.find((s) => s.info.address.toLowerCase() === a?.spender.toLowerCase());
  const scope = a?.unlimited ? "Unlimited approval" : "Approval";
  if (spender?.info.code === "eoa") return `${scope} to a wallet address, not a contract`;
  const bits: string[] = [];
  if (spender?.info.verified === false) bits.push("unverified");
  if (spender?.age && spender.age.days < 30) bits.push(`${Math.max(1, Math.floor(spender.age.days))}-day-old`);
  if (spender?.info.proxy) bits.push("proxy");
  return `${scope} to ${bits.length ? `an ${bits.join(", ")}` : "an unverified"} spender`;
}

function uiReason(facts: Facts, check: SigningCheck): string {
  const a = facts.approvals[0];
  const label = facts.input.ui.buttonLabel ?? "";
  const said = /(\d[\d,]*(?:\.\d+)?)/.exec(label)?.[1];
  if (a?.unlimited && said) return `Unlimited where the UI shows ${said}`;
  return check.detail.replace(/\.$/, "");
}

/** Warnings worth listing under the main reason, without repeating it. */
function secondary(checks: SigningCheck[], already: string[]): string[] {
  const out: string[] = [];
  for (const c of checks) {
    if (c.id === "known-bad" || c.id === "approval" || c.id === "ui-match") continue;
    if (c.status === "fail" || c.status === "warn") out.push(short(c));
  }
  return out.filter((r) => !already.includes(r));
}

/** One short phrase per check for the explanation bullets. */
function short(c: SigningCheck): string {
  switch (c.id) {
    case "baseline": {
      const changed = (c.evidence?.changes as { field: string }[] | undefined)?.map((x) => x.field) ?? [];
      return changed.length ? `Different ${changed.join(", ")} from the last run` : "Differs from the last run";
    }
    case "approval":
      return c.status === "warn" ? "Unlimited approval" : c.status === "unverified" ? "Couldn't confirm the spender's source" : c.detail.replace(/\.$/, "");
    case "verified-source":
      return c.status === "unverified" ? "Couldn't check the source" : "No verified source";
    case "contract-age":
      return c.status === "unverified" ? "Deployment date unknown" : "Recently deployed";
    case "proxy":
      return c.status === "unverified" ? "Couldn't inspect the proxy" : "Proxy with an unverified implementation";
    case "token":
      return c.status === "unverified" ? "Token source unknown" : "Token has no verified source";
    case "known-bad":
      return c.status === "unverified" ? "Blocklists unavailable" : "On a known-bad list";
    case "simulation":
      return c.status === "warn" ? "Reverts on the fork" : "Not simulated";
    case "ui-match":
      return c.status === "unverified" ? "Couldn't compare with the button" : c.detail.replace(/\.$/, "");
    case "expectation":
      return "Doesn't match the flow's expectation";
    default:
      return c.detail.replace(/\.$/, "");
  }
}
