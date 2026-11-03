/**
 * The signing reviewer: decode → simulate → approvals → checks → verdict → prose.
 * Never throws for a weird request: anything unexpected degrades to a "check"
 * verdict with the checks marked unverified.
 */
import { createPublicClient, http as httpTransport, type Address, type PublicClient } from "viem";
import { chainInfo, fingerprint, newId, SigningReview, type ApprovalGrant, type DecodedArg, type DecodedRequest } from "@dappdrill/core";
import type { SigningInput, SigningReviewer } from "../types.js";
import { approvalsFromCalls, approvalsFromTyped } from "./approvals.js";
import { addressesOf, buildChecks, diffBaseline } from "./checks.js";
import { Contracts, type TokenInfo } from "./contract.js";
import { decodeMessage } from "./decode-message.js";
import { decodeCall, flattenCalls, type DecodedCall } from "./decode-tx.js";
import { decodeTypedData } from "./decode-typed.js";
import { erc7730TypedData } from "./erc7730.js";
import { hasStake, nativeValue, outgoing, type Facts, type Subject } from "./facts.js";
import { hostOf, plain } from "./format.js";
import { Http, withTimeout } from "./http.js";
import { KnownBad } from "./known-bad.js";
import { writeProse } from "./prose.js";
import { parseRequest, type ParsedRequest } from "./request.js";
import { simulate } from "./simulate.js";
import { siweDomainMatches } from "./decode-message.js";
import { matchByModel, matchByRules, type RequestSummary, type UiMatchResult } from "./ui-match.js";
import { decideVerdict } from "./verdict.js";

export interface ReviewerOptions {
  etherscanApiKey?: string;
  cacheDir?: string;
  fetch?: typeof fetch;
  /** Per-lookup timeout for explorers, registries and RPC probes. Default 10s. */
  lookupTimeoutMs?: number;
}

export class Reviewer implements SigningReviewer {
  private readonly http: Http;
  private readonly knownBad: KnownBad;
  private readonly etherscanApiKey?: string;
  private readonly timeout: number;
  /** Edge cases replay the same request many times; the model sees each label and request once. */
  private readonly byModel = new Map<string, Promise<UiMatchResult>>();

  constructor(opts: ReviewerOptions = {}) {
    this.http = new Http({ fetch: opts.fetch, cacheDir: opts.cacheDir });
    this.knownBad = new KnownBad(this.http);
    this.etherscanApiKey = opts.etherscanApiKey ?? process.env.ETHERSCAN_API_KEY;
    this.timeout = opts.lookupTimeoutMs ?? 10_000;
  }

  async review(input: SigningInput): Promise<SigningReview> {
    try {
      return await this.run(input);
    } catch (e) {
      return fallback(input, e as Error);
    }
  }

  private async run(input: SigningInput): Promise<SigningReview> {
    const { request } = input;
    const chainId = request.chainId;
    const parsed = parseRequest(request);
    const chainAvailable = safeHas(input, chainId);
    const config = chainAvailable ? input.chains.configs().find((c) => c.id === chainId) : undefined;
    const client = chainAvailable ? input.chains.client(chainId) : undefined;
    const upstream = config && input.chains.mode(chainId) === "fork" ? createPublicClient({ transport: httpTransport(config.rpcUrl, { timeout: this.timeout }) }) : undefined;
    const contracts = new Contracts({
      http: this.http,
      chainId,
      client,
      upstream,
      etherscanApiKey: this.etherscanApiKey,
      headBlock: config?.forkBlock ? BigInt(config.forkBlock) : undefined,
      lookupTimeoutMs: this.timeout,
    });
    const nativeSymbol = chainInfo(chainId)?.nativeSymbol ?? "ETH";
    const decodeDeps = { http: this.http, chainId, contracts, lookupTimeoutMs: this.timeout };

    // 1. Decode.
    let calls: DecodedCall[] = [];
    let typed: Facts["typed"];
    let message: Facts["message"];
    let approvals: ApprovalGrant[] = [];
    let erc7730: Facts["erc7730"];
    let targetAddress: Address | undefined;
    if (parsed.kind === "transaction") {
      calls = await Promise.all(parsed.calls.map((c) => decodeCall(c, decodeDeps)));
      approvals = await approvalsFromCalls(flattenCalls(calls), contracts);
      targetAddress = calls[0]?.to;
    } else if (parsed.kind === "typedData") {
      typed = decodeTypedData(parsed.typedData);
      approvals = await approvalsFromTyped(typed, contracts);
      targetAddress = typed.domain.verifyingContract;
      if (targetAddress) erc7730 = await withTimeout(erc7730TypedData(this.http, chainId, targetAddress, typed.primaryType).catch(() => undefined), this.timeout, undefined);
    } else if (parsed.kind === "message") {
      message = decodeMessage(parsed);
    }
    const allCalls = flattenCalls(calls);

    // 2. Facts about the contracts and tokens involved, in parallel and bounded.
    const spenderAddresses = [...new Set(approvals.map((a) => a.spender.toLowerCase()))] as Address[];
    const [target, spenders, tokens] = await Promise.all([
      targetAddress ? this.subject(contracts, targetAddress, parsed.kind === "transaction" && !approvals.length) : undefined,
      Promise.all(spenderAddresses.map((a) => this.subject(contracts, a, true))),
      this.tokens(contracts, approvals, targetAddress),
    ]);

    const fp = fingerprint(input.flow?.id, input.flow?.stepIndex, request.method, targetAddress?.toLowerCase(), calls[0]?.selector ?? typed?.primaryType);
    const decoded = toDecoded(parsed, calls, typed, message, target);
    const facts: Facts = {
      input,
      chainId,
      chainAvailable,
      nativeSymbol,
      pageHost: hostOf(input.ui.pageUrl),
      parsed,
      from: parsed.from,
      calls,
      allCalls,
      typed,
      message,
      decoded,
      approvals,
      target,
      spenders,
      tokens,
      knownBad: { hits: [], unavailable: [] },
      erc7730,
      fingerprint: fp,
    };

    // 3. Simulation and blocklists.
    const [simulation, knownBad] = await Promise.all([
      parsed.kind === "transaction" && parsed.from
        ? simulate({ chains: input.chains, chainId, from: parsed.from, calls: parsed.calls, contracts, approvals, nativeSymbol })
        : undefined,
      withTimeout(this.knownBad.check(addressesOf(facts), facts.pageHost), 45_000, { hits: [], unavailable: ["blocklists (timed out)"] }),
    ]);
    facts.simulation = simulation;
    facts.knownBad = knownBad;

    // 4. UI comparison, checks, verdict, prose.
    const ui = await this.uiMatch(facts);
    const checks = buildChecks(facts, ui);
    const decision = decideVerdict(facts, checks);
    const prose = writeProse(facts, checks, decision);
    const previous = input.baselines[fp];

    return SigningReview.parse({
      id: newId("sgr"),
      requestId: request.id,
      flowId: input.flow?.id,
      stepIndex: input.flow?.stepIndex,
      chainId,
      method: request.method,
      verdict: decision.verdict,
      title: prose.title,
      summary: prose.summary,
      ui: input.ui,
      decoded,
      simulation: simulation ? { status: simulation.status, balanceChanges: simulation.balanceChanges, revertReason: simulation.revertReason, gasUsed: simulation.gasUsed } : undefined,
      approvals,
      checks,
      explanation: prose.explanation,
      advice: prose.advice,
      baseline: previous ? { previousAt: previous.createdAt, changes: diffBaseline(previous, { decoded, approvals, chainId }) } : undefined,
      fingerprint: fp,
      createdAt: new Date().toISOString(),
    });
  }

  private async subject(contracts: Contracts, address: Address, withAge: boolean): Promise<Subject> {
    const info = await contracts.info(address);
    if (!withAge || info.code === "eoa" || info.known) return { info };
    const [age, implementationAge] = await Promise.all([contracts.age(address), info.proxy ? contracts.age(info.proxy.implementation) : undefined]);
    return { info, age, implementationAge };
  }

  private async tokens(contracts: Contracts, approvals: ApprovalGrant[], target: Address | undefined): Promise<TokenInfo[]> {
    const addresses = new Set(approvals.map((a) => a.token.toLowerCase()));
    if (target) addresses.add(target.toLowerCase());
    const found = await Promise.all([...addresses].map((a) => contracts.token(a as Address)));
    return found.filter((t): t is TokenInfo => !!t && t.standard !== "none");
  }

  private async uiMatch(facts: Facts): Promise<UiMatchResult> {
    const { ui, llm, artifactsDir } = facts.input;
    const summary = requestSummary(facts);
    const decimals = (token: string) => facts.tokens.find((t) => t.address.toLowerCase() === token.toLowerCase())?.decimals;
    const byRules = matchByRules(ui.buttonLabel, summary, decimals);
    if (byRules?.status === "fail" || !llm) return byRules ?? { status: "unverified", detail: "The label doesn't say enough to compare with the request, and no model was available.", via: "none" };
    const key = `${ui.buttonLabel ?? ""}\n${ui.context ?? ""}\n${summary.description}`;
    if (!this.byModel.has(key)) {
      const asked = withTimeout(matchByModel(llm, ui, summary, artifactsDir), 60_000, { status: "unverified" as const, detail: "The model check timed out.", via: "none" as const });
      this.byModel.set(key, asked);
      // Only a real answer is worth reusing.
      void asked.then((r) => r.status === "unverified" && this.byModel.delete(key), () => this.byModel.delete(key));
    }
    const byModel = await this.byModel.get(key)!;
    if (!byRules) return byModel;
    // The rules found concrete agreement; the model can only soften it to a warning.
    if (byModel.status === "fail" && byRules.status === "pass") return { ...byModel, status: "warn", detail: `${byRules.detail} The model disagrees: ${byModel.detail}` };
    if (byModel.status === "unverified") return byRules;
    return byModel.status === "pass" ? { ...byRules, detail: `${byRules.detail} ${byModel.detail}`, via: "model", evidence: byModel.evidence } : byModel;
  }
}

function safeHas(input: SigningInput, chainId: number): boolean {
  try {
    return input.chains.has(chainId);
  } catch {
    return false;
  }
}

function requestSummary(facts: Facts): RequestSummary {
  const call = facts.calls[0];
  const siwe = facts.message?.siwe;
  const description =
    facts.parsed.kind === "transaction"
      ? `${facts.input.request.method} → ${call?.to ?? "contract creation"} ${call?.signature ?? "(no calldata)"}${call?.args.length ? ` with ${call.args.map((a) => `${a.name}=${a.display ?? a.value}`).join(", ")}` : ""}${nativeValue(facts) > 0n ? `, value ${nativeValue(facts)} wei` : ""}${facts.allCalls.length > 1 ? `; nested: ${facts.allCalls.slice(1).map((c) => c.signature ?? c.functionName ?? "?").join(", ")}` : ""}`
      : facts.parsed.kind === "typedData"
        ? `${facts.input.request.method} ${facts.typed?.primaryType} (${facts.typed?.kind}) for domain ${JSON.stringify(facts.typed?.domain)}; fields: ${facts.typed?.args.slice(0, 20).map((a) => `${a.name}=${a.value}`).join(", ")}`
        : facts.parsed.kind === "message"
          ? `${facts.input.request.method}: ${facts.message?.isHash ? "opaque 32-byte hash" : `"${(facts.message?.text ?? "").slice(0, 500)}"`}`
          : `${facts.input.request.method}: could not be decoded`;
  return {
    kind: facts.parsed.kind === "unknown" ? "message" : facts.parsed.kind,
    functionName: call?.functionName,
    primaryType: facts.typed?.primaryType,
    approvals: facts.approvals,
    outgoing: outgoing(facts),
    valueWei: nativeValue(facts),
    nativeSymbol: facts.nativeSymbol,
    siwe: siwe ? { domain: siwe.domain, matchesPage: siweDomainMatches(siwe.domain, facts.pageHost), pageHost: facts.pageHost } : undefined,
    isHash: facts.message?.isHash,
    description,
  };
}

function toDecoded(parsed: ParsedRequest, calls: DecodedCall[], typed: Facts["typed"], message: Facts["message"], target: Subject | undefined): DecodedRequest {
  if (parsed.kind === "transaction") {
    const call = calls[0];
    const args: DecodedArg[] = [...(call?.args ?? [])];
    const nested = flattenCalls(calls).filter((c) => c !== call);
    for (const [i, c] of nested.entries()) {
      args.push({ name: `call #${i + 1}`, type: "call", value: c.signature ?? c.functionName ?? c.data.slice(0, 10), display: `${c.functionName ?? c.data.slice(0, 10)}(${c.args.map((a) => a.display ?? a.value).join(", ")})${c.to && c.to !== call?.to ? ` on ${c.to}` : ""}` });
    }
    return {
      kind: "transaction",
      to: call?.to,
      contractName: target?.info.name,
      functionName: call?.functionName,
      signature: call?.signature,
      args,
      value: nativeValue({ calls } as Facts).toString(),
      calldata: call?.data,
      abiSource: call?.abiSource ?? "none",
    };
  }
  if (parsed.kind === "typedData" && typed) {
    return {
      kind: "typedData",
      to: typed.domain.verifyingContract,
      contractName: target?.info.name ?? typed.domain.name,
      primaryType: typed.primaryType,
      domain: plain(parsed.typedData.domain) as Record<string, unknown>,
      args: typed.args,
      abiSource: "none",
    };
  }
  if (parsed.kind === "message") {
    return { kind: "message", message: message?.text ?? parsed.raw, args: [], abiSource: "none" };
  }
  return { kind: "message", message: parsed.kind === "unknown" ? parsed.reason : "Typed data could not be decoded", args: [], abiSource: "none" };
}

/** Review returned when the reviewer itself failed: never "consistent", everything unverified. */
function fallback(input: SigningInput, error: Error): SigningReview {
  const { request } = input;
  const detail = `The reviewer hit an error and could not finish: ${error.message}`;
  return SigningReview.parse({
    id: newId("sgr"),
    requestId: request.id,
    flowId: input.flow?.id,
    stepIndex: input.flow?.stepIndex,
    chainId: request.chainId,
    method: request.method,
    verdict: "check",
    title: `Unreviewed ${request.method} request`,
    summary: `The wallet was asked for ${request.method}, but the review could not be completed.`,
    ui: input.ui,
    decoded: { kind: "message", message: safeStringify(request.params), args: [], abiSource: "none" },
    approvals: [],
    checks: [{ id: "ui-match", label: "Matches the button", status: "unverified", detail }],
    explanation: `Worth a look. ${detail}.`,
    advice: "Re-run the review; if it keeps failing, report the request shape to DappDrill.",
    fingerprint: fingerprint(input.flow?.id, input.flow?.stepIndex, request.method),
    createdAt: new Date().toISOString(),
  });
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(plain(v)).slice(0, 2000);
  } catch {
    return String(v);
  }
}

export { hasStake };
