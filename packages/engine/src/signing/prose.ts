/**
 * Plain-language title, summary, explanation and advice, in the voice of the
 * mockups: say what the button said, what the wallet is asked, and why that matters.
 */
import { shortAddress, type SigningCheck, type Verdict } from "@dappdrill/core";
import { NEW_CONTRACT_DAYS, nativeValue, outgoing, type Facts, type Subject } from "./facts.js";
import { daysAgo, displayNative } from "./format.js";
import type { Decision } from "./verdict.js";

export interface Prose {
  title: string;
  summary: string;
  explanation: string;
  advice?: string;
}

export function writeProse(facts: Facts, checks: SigningCheck[], decision: Decision): Prose {
  return {
    title: title(facts),
    summary: summary(facts),
    explanation: explanation(decision),
    advice: advice(facts, checks, decision.verdict),
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nameOf = (s: Subject | undefined, fallback?: string) => s?.info.name ?? (fallback ? shortAddress(fallback) : undefined);

function title(facts: Facts): string {
  const a = facts.approvals[0];
  if (a) {
    const verb = a.standard === "permit" || a.standard === "permit2" ? "Permit" : "Approve";
    const what = a.standard.endsWith("-all") ? `all ${a.symbol ?? "tokens"}` : (a.symbol ?? shortAddress(a.token));
    const batch = facts.calls.length > 1 ? ` (+${facts.calls.length - 1} more)` : "";
    return `${verb} ${what} for ${a.spenderName ?? shortAddress(a.spender)}${batch}`;
  }
  if (facts.parsed.kind === "message") {
    const siwe = facts.message?.siwe;
    if (siwe) return `Sign in to ${siwe.domain}`;
    return facts.message?.isHash ? "Sign an opaque hash" : "Sign a message";
  }
  if (facts.parsed.kind === "typedData" && facts.typed) {
    if (facts.typed.kind === "seaport") return "Sign a Seaport order";
    const where = facts.typed.domain.name ?? nameOf(facts.target, facts.typed.domain.verifyingContract);
    return `Sign ${facts.typed.primaryType}${where ? ` for ${where}` : ""}`;
  }
  if (facts.parsed.kind === "transaction") {
    const call = facts.calls[0];
    if (!call) return "Empty transaction";
    const target = nameOf(facts.target, call.to) ?? "a new contract";
    if (!call.to) return "Deploy a contract";
    const value = nativeValue(facts);
    if (!call.functionName) return `Send ${displayNative(value, facts.nativeSymbol)} to ${target}`;
    const intent = call.erc7730?.intent ?? cap(call.functionName.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
    const amount = value > 0n ? displayNative(value, facts.nativeSymbol) : call.args.find((x) => /^(amount|value|wad|assets|shares|amountIn)$/.test(x.name))?.display;
    const batch = facts.calls.length > 1 ? ` (+${facts.calls.length - 1} more)` : "";
    return `${intent}${amount ? ` ${amount}` : ""} on ${target}${batch}`;
  }
  return `Unrecognised ${facts.input.request.method} request`;
}

function summary(facts: Facts): string {
  const label = facts.input.ui.buttonLabel;
  const first = label ? `The button says “${label}”. ` : "";
  return `${first}The wallet is asked to ${asked(facts)}.`;
}

/** "approve unlimited USDC for 0x9f…c2, a contract with no verified source that was deployed 3 days ago" */
function asked(facts: Facts): string {
  const a = facts.approvals[0];
  if (a) {
    const spender = facts.spenders.find((s) => s.info.address.toLowerCase() === a.spender.toLowerCase());
    const verb = a.standard === "permit" || a.standard === "permit2" ? (a.display.endsWith("(transfer)") ? "let" : "permit") : "approve";
    const scope = a.unlimited ? `unlimited ${a.symbol ?? "tokens"}` : a.standard.endsWith("-all") ? `all ${a.symbol ?? "tokens"}` : `${a.display.replace(/\s*\(transfer\)$/, "")}${a.symbol && !a.display.includes(a.symbol) ? ` ${a.symbol}` : ""}`;
    const more = facts.approvals.length > 1 ? ` (and ${facts.approvals.length - 1} more)` : "";
    if (verb === "let") return `let ${shortAddress(a.spender)}${qualify(spender)} take ${scope}${more}`;
    return `${verb} ${scope} for ${shortAddress(a.spender)}${qualify(spender)}${more}`;
  }
  if (facts.parsed.kind === "message") {
    const siwe = facts.message?.siwe;
    if (siwe) return `sign a sign-in message for ${siwe.domain}${facts.pageHost && siwe.domain.replace(/:\d+$/, "") !== facts.pageHost ? ` while the page is ${facts.pageHost}` : ""}`;
    if (facts.message?.isHash) return "sign a raw hash that can't be read";
    const text = facts.message?.text ?? "";
    return `sign the message “${text.length > 80 ? `${text.slice(0, 77)}…` : text}”`;
  }
  if (facts.parsed.kind === "typedData" && facts.typed) {
    if (facts.typed.kind === "seaport" && facts.typed.seaport) {
      return `sign a Seaport order offering ${facts.typed.seaport.offer.join(", ") || "nothing"} for ${facts.typed.seaport.consideration.join(", ") || "nothing"}`;
    }
    const where = facts.typed.domain.name ?? (facts.typed.domain.verifyingContract ? shortAddress(facts.typed.domain.verifyingContract) : undefined);
    return `sign ${facts.typed.primaryType} typed data${where ? ` for ${where}` : ""}`;
  }
  if (facts.parsed.kind === "transaction") {
    const call = facts.calls[0];
    if (!call) return "send an empty transaction";
    if (!call.to) return "deploy a contract";
    const target = `${shortAddress(call.to)}${qualify(facts.target)}`;
    const value = nativeValue(facts);
    if (!call.functionName) return `send ${displayNative(value, facts.nativeSymbol)} to ${target}`;
    const argText = call.args.length ? `(${call.args.slice(0, 4).map((x) => x.display ?? truncate(x.value)).join(", ")}${call.args.length > 4 ? ", …" : ""})` : "()";
    const inner = facts.calls.length > 1 ? ` plus ${facts.calls.length - 1} more call${facts.calls.length > 2 ? "s" : ""}` : call.inner.length ? ` which makes ${call.inner.length} inner call${call.inner.length > 1 ? "s" : ""}` : "";
    const sim = facts.simulation;
    const leaves = outgoing(facts);
    const effect =
      sim?.status === "reverted" ? `; on the fork it reverts (${sim.revertReason})` : leaves.length ? `; on the fork ${leaves.map((c) => c.display).join(", ")} leaves the wallet` : "";
    return `call ${call.functionName}${argText} on ${target}${value > 0n ? ` with ${displayNative(value, facts.nativeSymbol)}` : ""}${inner}${effect}`;
  }
  return `handle ${facts.input.request.method}, which couldn't be decoded`;
}

/** ", a contract with no verified source that was deployed 3 days ago" */
function qualify(s: Subject | undefined): string {
  if (!s) return "";
  if (s.info.code === "eoa") return ", a wallet address rather than a contract";
  const bits: string[] = [];
  if (s.info.name) bits.push(s.info.name);
  if (s.info.verified === false) bits.push("no verified source");
  else if (s.info.verified) bits.push("verified");
  const text = bits.length ? ` (${bits.join(", ")})` : "";
  const age = s.age && s.age.days < NEW_CONTRACT_DAYS ? ` that was deployed ${daysAgo(s.age.days)}` : "";
  if (s.info.verified === false && !s.info.name) return `, a contract with no verified source${age}`;
  return `${text}${age}`;
}

function truncate(v: string): string {
  return v.length > 24 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v;
}

function explanation(d: Decision): string {
  const lead = d.verdict === "dangerous" ? "Don't ship this." : d.verdict === "check" ? "Worth a look." : "The request matches what the page says and every check we could run passed.";
  if (!d.reasons.length) return lead;
  return `${lead} ${d.reasons.map((r) => `${r.replace(/\.$/, "")}.`).join(" ")}`;
}

function advice(facts: Facts, checks: SigningCheck[], verdict: Verdict): string | undefined {
  if (verdict === "consistent") return undefined;
  const byId = Object.fromEntries(checks.map((c) => [c.id, c])) as Record<SigningCheck["id"], SigningCheck | undefined>;
  const tips: string[] = [];
  const a = facts.approvals[0];
  const spender = a && facts.spenders.find((s) => s.info.address.toLowerCase() === a.spender.toLowerCase());
  if (byId["known-bad"]?.status === "fail") tips.push("Stop: a blocklisted address or domain is involved. Find out how it got into the request before anything else.");
  if (spender?.info.code === "eoa") tips.push("Approvals should go to the contract that pulls the tokens, never to a wallet address.");
  else if (spender && (spender.info.verified === false || (spender.age && spender.age.days < NEW_CONTRACT_DAYS))) {
    tips.push(byId.baseline?.status === "warn" ? "If you did move to a new router: verify its source, limit the approval to the deposit amount, then mark it as expected. Future runs will check against it." : "Verify the spender's source on Sourcify or the explorer so users (and this review) can read what it does.");
  }
  if (a?.unlimited) tips.push("Limit the approval to the amount shown, or use a permit with a deadline.");
  if (byId["ui-match"]?.status === "fail" || byId["ui-match"]?.status === "warn") tips.push("Make the button say what the wallet will ask for: the action, the token and the amount.");
  if (byId["ui-match"]?.status === "unverified") tips.push("No button label was captured; give the control an accessible name so the request can be compared with it.");
  if (byId.simulation?.status === "warn") tips.push(`The transaction reverts on a fork of the current chain state (${facts.simulation?.revertReason}); the page should not offer it in this state.`);
  if (byId.expectation?.status === "fail") tips.push("Either the dApp changed or the test's expectation is stale: update the expectation if the change is intended.");
  if (byId.baseline?.status === "warn" && !tips.some((t) => t.startsWith("If you did move"))) tips.push("If this change is intended, accept it as the new baseline.");
  if (facts.message?.siwe && byId["ui-match"]?.status === "fail") tips.push("The SIWE domain must be the page's own origin; wallets warn users when it isn't.");
  if (!tips.length && byId["known-bad"]?.status === "unverified") tips.push("The blocklists couldn't be loaded this time; re-run with network access to complete the check.");
  return tips.length ? tips.join(" ") : undefined;
}
