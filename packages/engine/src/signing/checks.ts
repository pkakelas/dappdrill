/**
 * The individual checks of a review. Each one turns gathered facts into a
 * SigningCheck with a plain detail sentence. The verdict is decided in verdict.ts.
 */
import type { Address } from "viem";
import { MAINNET_CHAIN_IDS, applyParams, chainName, matchesFunction, shortAddress, type BaselineChange, type CheckStatus, type SigningCheck, type SigningReview, type WalletExpectation } from "@dappdrill/core";
import { formatUnitsPlain } from "@dappdrill/core";
import { NEW_CONTRACT_DAYS, hasStake, nativeValue, type Facts, type Subject } from "./facts.js";
import { isLocalChain } from "./contract.js";
import { daysAgo, displayAddress } from "./format.js";
import type { UiMatchResult } from "./ui-match.js";

const ORDER: CheckStatus[] = ["pass", "skip", "unverified", "warn", "fail"];
export const worst = (...s: CheckStatus[]): CheckStatus => s.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "pass");

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function buildChecks(facts: Facts, ui: UiMatchResult): SigningCheck[] {
  return [
    uiMatch(facts, ui),
    verifiedSource(facts),
    baseline(facts),
    contractAge(facts),
    proxy(facts),
    token(facts),
    knownBad(facts),
    approval(facts),
    expectation(facts),
    simulation(facts),
    erc7730(facts),
  ];
}

function uiMatch(facts: Facts, ui: UiMatchResult): SigningCheck {
  const label = facts.input.ui.buttonLabel;
  if (!label && ui.via === "none") {
    return { id: "ui-match", label: "Matches the button", status: "unverified", detail: "No button label was captured for this request, so it couldn't be compared with the page.", evidence: ui.evidence };
  }
  return { id: "ui-match", label: "Matches the button", status: ui.status, detail: ui.detail, evidence: { ...ui.evidence, via: ui.via, buttonLabel: label } };
}

/** The spenders when something is approved, otherwise the target. */
function subjects(facts: Facts): Subject[] {
  return facts.spenders.length ? facts.spenders : facts.target ? [facts.target] : [];
}

function verifiedSource(facts: Facts): SigningCheck {
  const list = subjects(facts);
  const label = facts.spenders.length ? "Spender has verified source" : "Contract has verified source";
  if (!list.length) return { id: "verified-source", label, status: "skip", detail: "No contract involved." };
  if (list.every((s) => s.info.code === "eoa")) return { id: "verified-source", label, status: "skip", detail: "The target is a wallet address, not a contract." };
  const parts: string[] = [];
  const statuses: CheckStatus[] = [];
  let unverified = false;
  for (const s of list) {
    const { info } = s;
    if (info.code === "eoa") continue;
    if (info.verified) {
      parts.push(`${displayAddress(info.address, info.name)} is verified on ${info.verifiedVia === "sourcify" ? "Sourcify" : "the explorer"}.`);
      if (info.verifiedVia === "explorer") unverified = true;
      statuses.push("pass");
    } else if (info.verified === false) {
      parts.push(`${shortAddress(info.address)} has no verified source on Sourcify${facts.input.chains ? "" : ""}.`);
      statuses.push("fail");
    } else if (info.known) {
      parts.push(`${displayAddress(info.address, info.known)} is a well-known contract.`);
      statuses.push("pass");
    } else {
      parts.push(isLocalChain(facts.chainId) ? `${displayAddress(info.address, info.name)} is on a local dev chain: no source verification to check.` : `Couldn't check ${shortAddress(info.address)}: Sourcify didn't answer.`);
      statuses.push(isLocalChain(facts.chainId) ? "skip" : "unverified");
    }
  }
  const t = facts.target?.info;
  if (facts.spenders.length && t && t.code !== "eoa" && !isLocalChain(facts.chainId) && !list.some((s) => same(s.info.address, t.address))) {
    parts.push(`The target ${displayAddress(t.address, t.name)} is ${t.verified ? "verified" : t.verified === false ? "not verified" : "of unknown status"}.`);
  }
  return { id: "verified-source", label, status: worst(...statuses), detail: parts.join(" "), unverified: unverified || undefined };
}

function contractAge(facts: Facts): SigningCheck {
  const list = subjects(facts).filter((s) => s.info.code !== "eoa");
  const label = facts.spenders.length ? "Spender age" : "Contract age";
  if (!list.length) return { id: "contract-age", label, status: "skip", detail: "No contract involved." };
  const parts: string[] = [];
  const statuses: CheckStatus[] = [];
  let unverified = false;
  for (const s of list) {
    const who = displayAddress(s.info.address, s.info.name);
    if (s.age) {
      if (s.age.source === "explorer") unverified = true;
      const fresh = s.age.days < NEW_CONTRACT_DAYS;
      let text = `${who} was deployed ${daysAgo(s.age.days)}${fresh ? " — new" : ""}.`;
      if (s.info.proxy && s.implementationAge) text += ` It's a proxy; its implementation was deployed ${daysAgo(s.implementationAge.days)}.`;
      parts.push(text);
      statuses.push(fresh || (s.implementationAge && s.implementationAge.days < NEW_CONTRACT_DAYS) ? "warn" : "pass");
    } else if (s.info.known) {
      parts.push(`${who} is a long-standing, well-known contract.`);
      statuses.push("pass");
    } else {
      parts.push(isLocalChain(facts.chainId) ? `${who} is on a local dev chain; deployment age isn't meaningful.` : `Couldn't find out when ${who} was deployed.`);
      statuses.push(isLocalChain(facts.chainId) ? "skip" : "unverified");
    }
  }
  return { id: "contract-age", label, status: worst(...statuses), detail: parts.join(" "), unverified: unverified || undefined };
}

function proxy(facts: Facts): SigningCheck {
  const list = [...subjects(facts), ...(facts.target && facts.spenders.length ? [facts.target] : [])].filter((s, i, arr) => s.info.code !== "eoa" && arr.findIndex((x) => same(x.info.address, s.info.address)) === i);
  if (!list.length) return { id: "proxy", label: "Proxy", status: "skip", detail: "No contract involved." };
  const proxies = list.filter((s) => s.info.proxy);
  if (!proxies.length) {
    const unknown = list.some((s) => s.info.code === "unknown");
    return { id: "proxy", label: "Proxy", status: unknown ? "unverified" : "pass", detail: unknown ? "Couldn't read the contract's storage to look for a proxy." : "Not a proxy." };
  }
  const parts: string[] = [];
  const statuses: CheckStatus[] = [];
  for (const s of proxies) {
    const p = s.info.proxy!;
    const impl = displayAddress(p.implementation, p.implementationName);
    const state = p.implementationVerified ? "verified" : p.implementationVerified === false ? "no verified source" : "verification unknown";
    parts.push(`${displayAddress(s.info.address, s.info.name)} is a${p.kind === "eip1167" ? " minimal (EIP-1167)" : ` ${p.kind}`} proxy to ${impl} (${state}).`);
    statuses.push(p.implementationVerified ? "pass" : p.implementationVerified === false ? "warn" : "unverified");
  }
  return { id: "proxy", label: "Proxy", status: worst(...statuses), detail: parts.join(" "), evidence: { proxies: proxies.map((s) => ({ address: s.info.address, ...s.info.proxy })) } };
}

function token(facts: Facts): SigningCheck {
  const tokens = facts.tokens.filter((t) => t.standard !== "none");
  if (!tokens.length) return { id: "token", label: "Token contract", status: "skip", detail: "No token involved." };
  if (!facts.chainAvailable) return { id: "token", label: "Token contract", status: "unverified", detail: "The chain isn't available, so the token couldn't be read on the fork." };
  const parts: string[] = [];
  const statuses: CheckStatus[] = [];
  for (const t of tokens) {
    const info = [facts.target, ...facts.spenders].find((s) => s && same(s.info.address, t.address))?.info;
    const name = t.symbol ?? shortAddress(t.address);
    if (info?.known) {
      parts.push(`The real ${t.symbol ?? info.known} on ${chainName(facts.chainId)}${info.verified ? ", verified" : ""}.`);
      statuses.push("pass");
    } else if (info?.verified || info?.proxy?.implementationVerified) {
      parts.push(`${name} (${t.name ?? t.standard.toUpperCase()}${t.decimals !== undefined ? `, ${t.decimals} decimals` : ""}) has verified source.`);
      statuses.push("pass");
    } else if (info?.verified === false) {
      parts.push(`${name} has no verified source.`);
      statuses.push("warn");
    } else {
      const read = `${name} read on the fork (${t.standard.toUpperCase()}${t.decimals !== undefined ? `, ${t.decimals} decimals` : ""})`;
      parts.push(isLocalChain(facts.chainId) ? `${read}; a local dev chain has no source to check.` : `${read}; source status unknown.`);
      statuses.push(isLocalChain(facts.chainId) ? "skip" : "unverified");
    }
  }
  return { id: "token", label: "Token contract", status: worst(...statuses), detail: parts.join(" ") };
}

function knownBad(facts: Facts): SigningCheck {
  const { hits, unavailable } = facts.knownBad;
  if (hits.length) {
    const detail = hits.map((h) => (h.kind === "domain" ? `The page's domain ${h.value} is on the ${h.list} blocklist.` : `${shortAddress(h.value)} is on the ${h.list} blocklist.`)).join(" ");
    return { id: "known-bad", label: "Known-bad lists", status: "fail", detail, evidence: { hits } };
  }
  if (unavailable.length) {
    return { id: "known-bad", label: "Known-bad lists", status: "unverified", detail: `Couldn't load ${unavailable.join(", ")}; the rest came back clean.` };
  }
  return { id: "known-bad", label: "Known-bad lists", status: "pass", detail: "Not on any list we check (ScamSniffer, MetaMask)." };
}

function approval(facts: Facts): SigningCheck {
  if (!facts.approvals.length) return { id: "approval", label: "Approval scope", status: "skip", detail: "Nothing is approved." };
  const parts: string[] = [];
  const statuses: CheckStatus[] = [];
  for (const a of facts.approvals) {
    const spender = facts.spenders.find((s) => same(s.info.address, a.spender));
    const who = displayAddress(a.spender, a.spenderName);
    const verb = a.standard === "permit" || a.standard === "permit2" ? "Permits" : "Approves";
    const scope = a.unlimited ? `unlimited ${a.symbol ?? "tokens"}` : `${a.display}${a.symbol && !a.display.includes(a.symbol) ? ` ${a.symbol}` : ""}`;
    const expiry = a.expiry ? `, until ${a.expiry.slice(0, 10)}` : "";
    let status: CheckStatus = a.unlimited ? "warn" : "pass";
    let why = a.unlimited ? "Unlimited approvals outlive the deposit." : "";
    if (spender?.info.code === "eoa") {
      status = "fail";
      why = "The spender is a wallet address, not a contract: whoever holds its key can take the tokens.";
    } else if (spender?.info.verified === false && !spender.info.known) {
      // On a testnet, unverified contracts are the rule; on mainnet, an allowance to one is a risk.
      const mainnet = MAINNET_CHAIN_IDS.has(facts.chainId);
      status = mainnet ? "fail" : "warn";
      why = `The spender has no verified source, so nobody can read what it does with the allowance.${mainnet ? "" : " Common on a testnet; verify it before mainnet."}`;
    } else if (spender?.age && spender.age.days < NEW_CONTRACT_DAYS) {
      status = "fail";
      why = `The spender was deployed ${daysAgo(spender.age.days)}.`;
    } else if (spender && spender.info.verified === undefined && !spender.info.known && !isLocalChain(facts.chainId)) {
      status = worst(status, "unverified");
      why = `${why} Couldn't confirm the spender's source.`.trim();
    }
    parts.push(`${verb} ${scope} for ${who}${expiry}. ${why}`.trim());
    statuses.push(status);
  }
  return { id: "approval", label: "Approval scope", status: worst(...statuses), detail: parts.join(" "), evidence: { approvals: facts.approvals } };
}

function expectation(facts: Facts): SigningCheck {
  const script = facts.input.script;
  const exp = script?.expectation;
  if (!script || !exp) return { id: "expectation", label: "Test expectation", status: "skip", detail: "No expectation set for this step." };
  const problems: string[] = [];
  const d = facts.decoded;
  const isPermit2 = facts.approvals.some((a) => a.standard === "permit2") || same(d.to, "0x000000000022D473030F116dDEE9F6B43aC78BA3");
  const acceptPermit2 = exp.alsoAcceptPermit2 && isPermit2;

  if (exp.kind && exp.kind !== d.kind && !acceptPermit2) problems.push(`expected a ${exp.kind}, got a ${d.kind}`);
  if (exp.to && !same(exp.to, d.to) && !acceptPermit2) problems.push(`expected target ${shortAddress(exp.to)}, got ${d.to ? shortAddress(d.to) : "none"}`);
  if (exp.functionName && !matchesFunction(exp.functionName, d) && !acceptPermit2) problems.push(`expected ${exp.functionName}(), got ${d.functionName ? `${d.functionName}()` : d.primaryType ?? "no function"}`);
  if (exp.spenderMustBe && !facts.approvals.some((a) => same(a.spender, exp.spenderMustBe))) {
    problems.push(`expected spender ${shortAddress(exp.spenderMustBe)}, got ${facts.approvals.map((a) => shortAddress(a.spender)).join(", ") || "no approval"}`);
  }
  if (exp.failIfUnlimited && facts.approvals.some((a) => a.unlimited)) problems.push("the approval is unlimited");
  if (exp.amountMustEqual) {
    const want = Number(applyParams(exp.amountMustEqual, script.params).replace(/,/g, ""));
    const got = expectedAmounts(facts);
    const close = (n: number) => Math.abs(n - want) <= Math.max(1e-9, want * 1e-6);
    if (!Number.isFinite(want)) problems.push(`amountMustEqual "${exp.amountMustEqual}" isn't a number`);
    else if (got.length === 0) problems.push(`expected amount ${want}, but no amount could be read`);
    else if (!got.some(close)) problems.push(`expected amount ${want}, got ${got[0]}`);
  }
  if (problems.length) return { id: "expectation", label: "Test expectation", status: "fail", detail: `Doesn't match the test's expectation: ${problems.join("; ")}.`, evidence: { expectation: exp } };
  return { id: "expectation", label: "Test expectation", status: "pass", detail: `Matches the test's expectation${describeExpectation(exp)}.`, evidence: { expectation: exp } };
}

/**
 * The amounts the test expectation can refer to, in human units: the approval
 * if there is one, else the native value and every balance change. A withdraw
 * of 5 assets burns 4.9 shares and pays out 5, so either side may be the typed amount.
 */
function expectedAmounts(facts: Facts): number[] {
  const human = (v: bigint, decimals: number) => Number(formatUnitsPlain(v, decimals, 18).replace(/,/g, ""));
  const a = facts.approvals[0];
  if (a) {
    if (a.unlimited) return [Number.POSITIVE_INFINITY];
    const t = facts.tokens.find((t) => same(t.address, a.token));
    return t?.decimals === undefined ? [] : [human(BigInt(a.amount), t.decimals)];
  }
  const out: number[] = [];
  const value = nativeValue(facts);
  if (value > 0n) out.push(human(value, 18));
  for (const c of facts.simulation?.balanceChanges ?? []) {
    if (!same(c.owner, facts.from) || c.decimals === undefined) continue;
    const d = BigInt(c.delta);
    // Outflows first: what the user pays is what they usually typed.
    if (d < 0n) out.unshift(human(-d, c.decimals));
    else if (d > 0n) out.push(human(d, c.decimals));
  }
  return out;
}

function describeExpectation(exp: WalletExpectation): string {
  const bits = [exp.functionName && `${exp.functionName}()`, exp.to && `to ${shortAddress(exp.to)}`, exp.spenderMustBe && `spender ${shortAddress(exp.spenderMustBe)}`, exp.amountMustEqual && `amount ${exp.amountMustEqual}`].filter(Boolean);
  return bits.length ? `: ${bits.join(", ")}` : "";
}

/** Fields compared against the accepted baseline. */
export function baselineFields(review: Pick<SigningReview, "decoded" | "approvals" | "chainId">): Record<string, string | undefined> {
  const a = review.approvals[0];
  return {
    target: review.decoded.to?.toLowerCase(),
    function: review.decoded.functionName,
    spender: a?.spender.toLowerCase(),
    amount: a ? (a.unlimited ? "unlimited" : a.amount) : review.decoded.value && review.decoded.value !== "0" ? review.decoded.value : undefined,
    chain: String(review.chainId),
    primaryType: review.decoded.primaryType,
    verifyingContract: typeof review.decoded.domain?.verifyingContract === "string" ? review.decoded.domain.verifyingContract.toLowerCase() : undefined,
  };
}

export function diffBaseline(previous: SigningReview, current: Pick<SigningReview, "decoded" | "approvals" | "chainId">): BaselineChange[] {
  const before = baselineFields(previous);
  const after = baselineFields(current);
  const changes: BaselineChange[] = [];
  for (const field of Object.keys(after)) {
    const b = before[field];
    const a = after[field];
    if ((b ?? "") !== (a ?? "")) changes.push({ field, before: b ?? "—", after: a ?? "—" });
  }
  return changes;
}

function baseline(facts: Facts): SigningCheck {
  const previous = facts.input.baselines[facts.fingerprint];
  if (!previous) return { id: "baseline", label: "Same as last run", status: "skip", detail: "No accepted earlier run to compare against." };
  const changes = diffBaseline(previous, { decoded: facts.decoded, approvals: facts.approvals, chainId: facts.chainId });
  const when = previous.createdAt.slice(0, 10);
  if (!changes.length) return { id: "baseline", label: "Same as last run", status: "pass", detail: `Same target, function, spender and amount as the run accepted on ${when}.`, evidence: { previousAt: previous.createdAt } };
  const prevSpender = previous.approvals[0];
  const was = prevSpender ? `approved ${prevSpender.display} to ${displayAddress(prevSpender.spender, prevSpender.spenderName)}` : `${previous.decoded.functionName ?? previous.decoded.primaryType ?? "signed"} on ${previous.decoded.to ? shortAddress(previous.decoded.to) : "?"}`;
  const detail = `On ${when} this step ${was}. Changed now: ${changes.map((c) => c.field).join(", ")}.`;
  return { id: "baseline", label: "Same as last run", status: "warn", detail, evidence: { previousAt: previous.createdAt, changes } };
}

function simulation(facts: Facts): SigningCheck {
  const sim = facts.simulation;
  if (facts.parsed.kind !== "transaction") return { id: "simulation", label: "Simulated", status: "skip", detail: "Nothing to simulate for a signature." };
  if (!sim || sim.status === "unavailable") {
    return { id: "simulation", label: "Simulated", status: "unverified", detail: sim?.revertReason ?? "Simulation unavailable." };
  }
  if (sim.status === "reverted") return { id: "simulation", label: "Simulated", status: "warn", detail: `Reverts on the fork: ${sim.revertReason ?? "no reason given"}.`, evidence: { revertReason: sim.revertReason } };
  const mine = sim.balanceChanges.filter((c) => same(c.owner, facts.from));
  const parts: string[] = [];
  parts.push(mine.length ? `Balance changes: ${mine.map((c) => c.display).join(", ")}.` : "No balance change now.");
  for (const a of sim.allowanceChanges) parts.push(`Allowance for ${shortAddress(a.spender)} goes from ${a.before} to ${a.after}.`);
  const stake = hasStake(facts);
  return { id: "simulation", label: "Simulated", status: "pass", detail: parts.join(" "), evidence: { gasUsed: sim.gasUsed, balanceChanges: sim.balanceChanges, stake } };
}

function erc7730(facts: Facts): SigningCheck {
  const m = facts.erc7730 ?? facts.calls.find((c) => c.erc7730)?.erc7730;
  if (!m) return { id: "erc7730", label: "ERC-7730 descriptor", status: "skip", detail: "No clear-signing descriptor published for this contract." };
  return { id: "erc7730", label: "ERC-7730 descriptor", status: "pass", detail: `${m.owner ?? "The protocol"} describes this as “${m.intent}”${m.labels.length ? ` (${m.labels.join(", ")})` : ""}.`, evidence: { descriptor: m.descriptor, intent: m.intent } };
}

export function addressesOf(facts: Facts): Address[] {
  const out = new Set<string>();
  const add = (a: string | undefined) => a && /^0x[0-9a-fA-F]{40}$/.test(a) && out.add(a);
  add(facts.target?.info.address);
  for (const a of facts.approvals) {
    add(a.spender);
    add(a.token);
  }
  for (const c of facts.allCalls) {
    add(c.to);
    for (const arg of c.args) if (arg.type === "address") add(arg.value);
  }
  for (const arg of facts.typed?.args ?? []) if (arg.type === "address") add(arg.value);
  return [...out] as Address[];
}
