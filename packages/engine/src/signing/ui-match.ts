/**
 * Does the wallet request match what the UI promised? A deterministic
 * comparison of the button label (and page context) against the decoded
 * action, token, amount and spender, plus an optional model check for the
 * cases the rules can't settle.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ApprovalGrant, BalanceChange, CheckStatus } from "@dappdrill/core";
import { formatUnitsPlain, shortAddress } from "@dappdrill/core";
import type { ImageInput, Llm } from "../types.js";

/** What a label or a request is, in one word. */
export type Intent = "approve" | "signin" | "deposit" | "withdraw" | "swap" | "claim" | "send" | "mint" | "sign" | "cancel" | "bridge" | "borrow" | "repay" | "vote" | "other";

const LABEL_WORDS: [RegExp, Intent][] = [
  [/\b(sign[\s-]?in|log[\s-]?in|login|connect|verify|authenticate|continue with)\b/, "signin"],
  [/\b(approve|approval|allow|enable|unlock|permit|authori[sz]e|grant)\b/, "approve"],
  [/\b(deposit|supply|lend|stake|wrap|provide|lock|add liquidity|contribute|fund|pay)\b/, "deposit"],
  [/\b(withdraw|unstake|redeem|unwrap|remove|exit|cash out)\b/, "withdraw"],
  [/\b(swap|trade|buy|sell|exchange|convert)\b/, "swap"],
  [/\b(claim|harvest|collect|receive|get reward)/, "claim"],
  [/\b(send|transfer|pay)\b/, "send"],
  [/\b(mint)\b/, "mint"],
  [/\b(bridge)\b/, "bridge"],
  [/\b(borrow)\b/, "borrow"],
  [/\b(repay)\b/, "repay"],
  [/\b(vote|delegate)\b/, "vote"],
  [/\b(cancel|revoke)\b/, "cancel"],
  [/\b(sign|accept|agree|confirm|continue|submit)\b/, "sign"],
];

const FUNCTION_WORDS: [RegExp, Intent][] = [
  [/^(approve|increaseallowance|setapprovalforall|permit|permit2_permit.*)$/, "approve"],
  [/^(deposit|supply|mint|stake|lock|addliquidity.*|provide.*|wrap.*|join.*|lend)$/, "deposit"],
  [/^(withdraw.*|redeem|unstake|unwrap.*|removeliquidity.*|exit|unlock)$/, "withdraw"],
  [/^(swap.*|exactinput.*|exactoutput.*|execute|trade|buy|sell|multicall|aggregate.*|v[234]_swap.*|fillorder.*)$/, "swap"],
  [/^(claim.*|harvest|getreward.*|collect.*)$/, "claim"],
  [/^(transfer|transferfrom|safetransferfrom|send.*|safebatchtransferfrom)$/, "send"],
  [/^(bridge.*|deposit.*to.*|outbound.*)$/, "bridge"],
  [/^(borrow)$/, "borrow"],
  [/^(repay.*)$/, "repay"],
  [/^(castvote.*|delegate.*|vote.*)$/, "vote"],
  [/^(cancel.*|revoke.*)$/, "cancel"],
];

export function labelIntent(label: string | undefined): Intent | undefined {
  if (!label) return undefined;
  const text = label.toLowerCase();
  for (const [re, intent] of LABEL_WORDS) if (re.test(text)) return intent;
  return undefined;
}

function functionIntent(functionName: string | undefined): Intent | undefined {
  if (!functionName) return undefined;
  const name = functionName.toLowerCase();
  for (const [re, intent] of FUNCTION_WORDS) if (re.test(name)) return intent;
  return undefined;
}

/** The button's USDC is the request's tUSDC or WETH is its ETH: a one- or two-letter prefix marks a test or wrapped version of the same token. */
function sameSymbol(said: string, actual: string): boolean {
  const a = actual.toUpperCase();
  const s = said.toUpperCase();
  return a === s || (a.endsWith(s) && a.length - s.length <= 2);
}

/** "Approve 250 USDC" → { amount: 250, symbol: "USDC" }; "Deposit 1.5" → { amount: 1.5 }. */
export function labelAmount(label: string | undefined): { amount: number; symbol?: string } | undefined {
  if (!label) return undefined;
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]{2,10})?/.exec(label.replace(/[$€£]/g, ""));
  if (!m) return undefined;
  const amount = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  // A symbol is written in capitals or mixed case (USDC, tUSDC, wstETH); a plain word after the number ("50 from your wallet") isn't one.
  const symbol = m[2] && /[A-Z]/.test(m[2]) && !/^(and|or|of|to|for|from|into|via|per|by|as|the|in|on|at|with|your|my|now|more|less|worth|total|each|fee|available|left|days?|hours?|min|minutes?|sec|x|%)$/i.test(m[2]) ? m[2].toUpperCase() : undefined;
  return { amount, symbol };
}

export interface RequestSummary {
  kind: "transaction" | "typedData" | "message";
  functionName?: string;
  primaryType?: string;
  approvals: ApprovalGrant[];
  /** Balance changes for the signer, from the simulation. */
  outgoing: BalanceChange[];
  valueWei: bigint;
  nativeSymbol: string;
  siwe?: { domain: string; matchesPage?: boolean; pageHost?: string };
  isHash?: boolean;
  /** One-line description of the request for the model and the detail text. */
  description: string;
}

export interface UiMatchResult {
  status: CheckStatus;
  detail: string;
  /** Where the answer came from. */
  via: "rules" | "model" | "none";
  evidence?: Record<string, unknown>;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);
const human = (a: ApprovalGrant) => a.display.replace(/\s*\(.*\)$/, "");
const amountOf = (a: ApprovalGrant, decimals: number | undefined) => (decimals === undefined ? undefined : Number(formatUnitsPlain(BigInt(a.amount), decimals, 18).replace(/,/g, "")));

/**
 * Deterministic rules. Returns undefined when nothing in the label settles it.
 */
export function matchByRules(label: string | undefined, req: RequestSummary, tokenDecimals: (token: string) => number | undefined): UiMatchResult | undefined {
  if (!label) return undefined;
  const intent = labelIntent(label);
  const said = labelAmount(label);
  const quoted = `“${label}”`;

  if (req.siwe?.matchesPage === false) {
    return { status: "fail", detail: `The sign-in message is for ${req.siwe.domain}, but the page is ${req.siwe.pageHost}.`, via: "rules" };
  }

  if (req.approvals.length > 0) {
    const a = req.approvals[0]!;
    const what = a.standard === "permit" || a.standard === "permit2" ? "a permit" : "an approval";
    // "Sign message" promises a harmless signature; a permit there hands over tokens.
    // Vaguer words that share the intent ("Continue", "Confirm") stay inconclusive.
    const saysSign = intent === "sign" && /\bsign\b/i.test(label);
    if (intent === "signin" || intent === "claim" || saysSign) {
      return { status: "fail", detail: `The button says ${quoted}, but the wallet is asked for ${what}: ${human(a)} for ${a.spenderName ?? shortAddress(a.spender)}.`, via: "rules" };
    }
    if (said) {
      if (a.unlimited) return { status: "fail", detail: `Button says ${said.amount} ${said.symbol ?? a.symbol ?? ""}; the request is unlimited.`.replace(/\s+;/, ";"), via: "rules" };
      if (said.symbol && a.symbol && !sameSymbol(said.symbol, a.symbol)) {
        return { status: "fail", detail: `Button says ${said.symbol}; the request is for ${a.symbol}.`, via: "rules" };
      }
      const actual = amountOf(a, tokenDecimals(a.token));
      if (actual !== undefined && !close(said.amount, actual)) {
        return { status: "fail", detail: `Button says ${said.amount} ${a.symbol ?? ""}; the request is for ${human(a)}.`, via: "rules" };
      }
      if (actual !== undefined) return { status: "pass", detail: `Button says ${said.amount} ${a.symbol ?? ""}; the request is for exactly ${human(a)}.`, via: "rules" };
    }
    if (intent === "approve") return { status: "pass", detail: `The button asks for an approval and the request is ${what} of ${human(a)}.`, via: "rules" };
    if (intent && intent !== "sign" && intent !== "other") {
      return { status: "pass", detail: `${quoted} led to ${what} of ${human(a)} for ${a.spenderName ?? shortAddress(a.spender)}, a usual first step before a ${intent}.`, via: "rules" };
    }
    return undefined;
  }

  if (req.kind === "message") {
    if (req.isHash) return { status: "warn", detail: `${quoted} asks the wallet to sign an opaque hash, which can't be read.`, via: "rules" };
    if (intent === "signin" || intent === "sign") return { status: "pass", detail: `${quoted} and the wallet is asked to sign a readable message.`, via: "rules" };
    if (said || intent) return { status: "warn", detail: `The button says ${quoted}, but the wallet is only asked to sign a message.`, via: "rules" };
    return undefined;
  }

  if (req.kind === "typedData") {
    if (intent === "signin") return { status: "warn", detail: `The button says ${quoted}, but the wallet is asked to sign ${req.primaryType} typed data.`, via: "rules" };
    return undefined;
  }

  // Plain transaction.
  const fnIntent = functionIntent(req.functionName);
  const leaves = req.outgoing.filter((c) => BigInt(c.delta) < 0n);
  if ((intent === "signin" || intent === "claim") && (req.valueWei > 0n || leaves.length > 0)) {
    const what = leaves.map((c) => c.display.replace(/^[−-]/, "")).join(", ") || `${formatUnitsPlain(req.valueWei, 18, 6)} ${req.nativeSymbol}`;
    return { status: "fail", detail: `The button says ${quoted}, but ${what} leaves the wallet.`, via: "rules" };
  }
  if (said) {
    const matching = said.symbol ? leaves.find((c) => c.symbol && sameSymbol(said.symbol!, c.symbol)) : undefined;
    if (matching && matching.decimals !== undefined) {
      const actual = Number(formatUnitsPlain(-BigInt(matching.delta), matching.decimals, 18).replace(/,/g, ""));
      if (!close(said.amount, actual)) return { status: "fail", detail: `Button says ${said.amount} ${said.symbol}; ${matching.display.replace(/^[−-]/, "")} leaves the wallet.`, via: "rules" };
      return { status: "pass", detail: `Button says ${said.amount} ${said.symbol} and exactly that leaves the wallet.`, via: "rules" };
    }
    if (said.symbol === req.nativeSymbol && req.valueWei > 0n) {
      const actual = Number(formatUnitsPlain(req.valueWei, 18, 18).replace(/,/g, ""));
      if (!close(said.amount, actual)) return { status: "fail", detail: `Button says ${said.amount} ${said.symbol}; the transaction sends ${formatUnitsPlain(req.valueWei, 18, 6)} ${req.nativeSymbol}.`, via: "rules" };
      return { status: "pass", detail: `Button says ${said.amount} ${said.symbol} and the transaction sends exactly that.`, via: "rules" };
    }
  }
  if (intent && fnIntent && intent === fnIntent) return { status: "pass", detail: `${quoted} and the call is ${req.functionName}().`, via: "rules" };
  if (intent && fnIntent && intent !== "sign" && intent !== fnIntent && fnIntent !== "swap") {
    return { status: "warn", detail: `The button says ${quoted}, but the call is ${req.functionName}().`, via: "rules" };
  }
  return undefined;
}

const ModelAnswer = z.object({
  matches: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

export async function matchByModel(
  llm: Llm,
  ui: { buttonLabel?: string; pageUrl?: string; context?: string; screenshot?: string },
  req: RequestSummary,
  artifactsDir?: string,
): Promise<UiMatchResult> {
  const images: ImageInput[] = [];
  if (ui.screenshot && artifactsDir) {
    try {
      images.push({ data: (await readFile(join(artifactsDir, ui.screenshot))).toString("base64"), mediaType: "image/png" });
    } catch {
      // No screenshot, text only.
    }
  }
  const system =
    "You review wallet requests for a dApp QA tool. Compare what the page promised (button label, nearby text, screenshot) with what the wallet is actually asked to sign. " +
    "Answer whether a careful user who read the button would expect exactly this request: same action, same token, same amount, same counterparty. " +
    "An unlimited approval behind a button that names an amount does not match. A permit or approval behind a 'sign in' button does not match. " +
    "An approval before a deposit/swap matches when the amount is consistent. Be strict about value leaving the wallet.";
  const prompt = [
    `Button label: ${ui.buttonLabel ?? "(none captured)"}`,
    `Page: ${ui.pageUrl ?? "(unknown)"}`,
    ui.context ? `Page context:\n${ui.context.slice(0, 2000)}` : "",
    `Wallet request: ${req.description}`,
    req.approvals.length ? `Grants: ${req.approvals.map((a) => `${a.display} of ${a.symbol ?? a.token} to ${a.spenderName ?? a.spender}${a.unlimited ? " (UNLIMITED)" : ""}`).join("; ")}` : "",
    req.outgoing.length ? `Simulated balance changes for the signer: ${req.outgoing.map((c) => c.display).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const answer = await llm.structured({ system, prompt, images, schema: ModelAnswer, name: "ui_match" });
    const status: CheckStatus = answer.matches ? "pass" : answer.confidence === "low" ? "warn" : "fail";
    return { status, detail: answer.reason, via: "model", evidence: { confidence: answer.confidence } };
  } catch (e) {
    return { status: "unverified", detail: `The model check failed: ${(e as Error).message}`, via: "none" };
  }
}
