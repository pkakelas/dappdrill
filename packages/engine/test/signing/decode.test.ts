import { describe, expect, it } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, parseAbiParameters, type Hex } from "viem";
import { BUILTIN_ABI } from "../../src/signing/builtin.js";
import { Contracts } from "../../src/signing/contract.js";
import { parseSiwe, siweDomainMatches } from "../../src/signing/decode-message.js";
import { decodeCall, flattenCalls } from "../../src/signing/decode-tx.js";
import { decodeTypedData } from "../../src/signing/decode-typed.js";
import { displayAmount, isUnlimited } from "../../src/signing/format.js";
import { Http } from "../../src/signing/http.js";
import { parseRequest } from "../../src/signing/request.js";
import { labelAmount, labelIntent, matchByRules } from "../../src/signing/ui-match.js";
import { approvalsFromCalls, approvalsFromTyped } from "../../src/signing/approvals.js";
import { fakeFetch } from "./fake-fetch.js";
import { FakeChain, fakeErc20, fakeErc721 } from "./fake-chain.js";
import * as F from "./fixtures.js";

const SIGDB = "https://api.openchain.xyz/signature-database/v1/lookup";

function deps(routes = {}) {
  const chain = new FakeChain(1, {
    [F.USDC_MAINNET]: fakeErc20({ symbol: "USDC", decimals: 6, totalSupply: 50_000_000_000n * 10n ** 6n }),
    [F.NFT]: fakeErc721({ symbol: "HARB" }),
    [F.VAULT]: {},
    [F.PERMIT2_ADDRESS]: {},
    [F.UNIVERSAL_ROUTER]: {},
  });
  const http = new Http({ fetch: fakeFetch(routes) });
  const contracts = new Contracts({ http, chainId: 1, client: chain.client(), lookupTimeoutMs: 2000 });
  return { http, chainId: 1, contracts, lookupTimeoutMs: 2000 };
}

describe("parseRequest", () => {
  it("reads eth_sendTransaction", () => {
    const p = parseRequest(F.txRequest(F.VAULT, "0x12345678", { value: 5n }));
    expect(p.kind).toBe("transaction");
    if (p.kind !== "transaction") return;
    expect(p.calls[0]).toMatchObject({ to: F.VAULT, data: "0x12345678", value: 5n });
    expect(p.from).toBe(F.WALLET);
  });

  it("reads personal_sign in either parameter order and decodes hex text", () => {
    const hex = `0x${Buffer.from("hello").toString("hex")}` as Hex;
    const a = parseRequest(F.signRequest("personal_sign", [hex, F.WALLET]));
    const b = parseRequest(F.signRequest("personal_sign", [F.WALLET, hex]));
    expect(a).toMatchObject({ kind: "message", text: "hello", isHash: false, from: F.WALLET });
    expect(b).toMatchObject({ kind: "message", text: "hello" });
  });

  it("flags eth_sign of a raw hash", () => {
    const p = parseRequest(F.signRequest("eth_sign", [F.WALLET, `0x${"ab".repeat(32)}`]));
    expect(p).toMatchObject({ kind: "message", isHash: true });
  });

  it("reads typed data given as a JSON string", () => {
    const p = parseRequest(F.signRequest("eth_signTypedData_v4", [F.WALLET, JSON.stringify(F.genericTypedData())]));
    expect(p.kind).toBe("typedData");
    if (p.kind === "typedData") expect(p.typedData.primaryType).toBe("Vote");
  });

  it("reads wallet_sendCalls batches", () => {
    const p = parseRequest(F.signRequest("wallet_sendCalls", [{ from: F.WALLET, chainId: "0x1", calls: [{ to: F.USDC_MAINNET, data: "0x" }, { to: F.VAULT, data: "0x", value: "0x1" }] }]));
    expect(p.kind).toBe("transaction");
    if (p.kind === "transaction") expect(p.calls).toHaveLength(2);
  });

  it("never throws on garbage", () => {
    expect(parseRequest(F.signRequest("eth_signTypedData_v4", [F.WALLET, "{not json"])).kind).toBe("unknown");
    expect(parseRequest(F.signRequest("eth_sendTransaction", [])).kind).toBe("transaction");
    expect(parseRequest(F.signRequest("wallet_weird", [1, 2])).kind).toBe("unknown");
  });
});

describe("SIWE", () => {
  it("parses a sign-in message and compares the domain with the page", () => {
    const siwe = parseSiwe(F.siweMessage("app.harborvault.xyz"));
    expect(siwe).toMatchObject({ domain: "app.harborvault.xyz", address: F.WALLET, chainId: 1, nonce: "8f1c2b9e7d", statement: "Sign in to Harbor Vault." });
    expect(siweDomainMatches("app.harborvault.xyz", "app.harborvault.xyz")).toBe(true);
    expect(siweDomainMatches("harborvault.xyz", "app.harborvault.xyz")).toBe(true);
    expect(siweDomainMatches("evil.xyz", "app.harborvault.xyz")).toBe(false);
    expect(parseSiwe("just a message")).toBeUndefined();
  });
});

describe("decodeTypedData", () => {
  it("recognises an EIP-2612 permit", () => {
    const t = decodeTypedData(F.eip2612Permit(F.USDC_MAINNET, F.VAULT, F.usdc(100), 1_900_000_000n));
    expect(t.kind).toBe("eip2612");
    expect(t.permits[0]).toMatchObject({ token: F.USDC_MAINNET, spender: F.VAULT, amount: F.usdc(100), permit2: false, transfer: false });
    expect(t.args.map((a) => a.name)).toEqual(["owner", "spender", "value", "nonce", "deadline"]);
  });

  it("recognises a DAI permit with allowed=true as unlimited", () => {
    const t = decodeTypedData(F.daiPermit(F.USDC_MAINNET, F.VAULT, true));
    expect(t.kind).toBe("dai-permit");
    expect(isUnlimited(t.permits[0]!.amount)).toBe(true);
    expect(t.permits[0]!.deadline).toBeUndefined();
  });

  it("recognises Permit2 single, batch and transfer permits", () => {
    const single = decodeTypedData(F.permit2Single(F.USDC_MAINNET, F.UNIVERSAL_ROUTER, F.PERMIT2_UNLIMITED, 1_900_000_000));
    expect(single.kind).toBe("permit2-single");
    expect(single.permits[0]).toMatchObject({ spender: F.UNIVERSAL_ROUTER, permit2: true, transfer: false });
    expect(isUnlimited(single.permits[0]!.amount, { permit2: true })).toBe(true);

    const batch = decodeTypedData(F.permit2Batch([{ token: F.USDC_MAINNET, amount: 1n }, { token: F.WETH_MAINNET, amount: 2n }], F.UNIVERSAL_ROUTER));
    expect(batch.kind).toBe("permit2-batch");
    expect(batch.permits).toHaveLength(2);
    expect(batch.args.find((a) => a.name === "details[1].token")?.value).toBe(F.WETH_MAINNET);

    const transfer = decodeTypedData(F.permit2TransferFrom(F.USDC_MAINNET, F.usdc(5), F.VAULT));
    expect(transfer.kind).toBe("permit2-transfer");
    expect(transfer.permits[0]).toMatchObject({ transfer: true, amount: F.usdc(5) });
  });

  it("falls back to generic", () => {
    const t = decodeTypedData(F.genericTypedData());
    expect(t.kind).toBe("generic");
    expect(t.permits).toHaveLength(0);
    expect(t.args).toHaveLength(3);
  });
});

describe("decodeCall", () => {
  it("decodes approve with token units and finds the grant", async () => {
    const d = deps();
    const call = await decodeCall({ to: F.USDC_MAINNET, data: F.approveData(F.VAULT, F.usdc(100)), value: 0n }, d);
    expect(call).toMatchObject({ functionName: "approve", signature: "approve(address,uint256)", abiSource: "builtin" });
    expect(call.args[1]!.display).toBe("100 USDC");
    const grants = await approvalsFromCalls([call], d.contracts);
    expect(grants[0]).toMatchObject({ standard: "erc20", symbol: "USDC", spender: F.VAULT, amount: F.usdc(100).toString(), unlimited: false });
  });

  it("flags unlimited approvals, including 'more than the supply'", async () => {
    const d = deps();
    const unlimited = await approvalsFromCalls([await decodeCall({ to: F.USDC_MAINNET, data: F.approveData(F.VAULT, F.UNLIMITED), value: 0n }, d)], d.contracts);
    expect(unlimited[0]).toMatchObject({ unlimited: true, display: "Unlimited (2²⁵⁶ − 1)" });
    const absurd = await approvalsFromCalls([await decodeCall({ to: F.USDC_MAINNET, data: F.approveData(F.VAULT, 10n ** 30n), value: 0n }, d)], d.contracts);
    expect(absurd[0]!.unlimited).toBe(true);
  });

  it("handles increaseAllowance, setApprovalForAll, NFT approve and Permit2 approve", async () => {
    const d = deps();
    const calls = await Promise.all([
      decodeCall({ to: F.USDC_MAINNET, data: F.increaseAllowanceData(F.VAULT, F.usdc(1)), value: 0n }, d),
      decodeCall({ to: F.NFT, data: F.setApprovalForAllData(F.VAULT, true), value: 0n }, d),
      decodeCall({ to: F.NFT, data: F.approveData(F.VAULT, 7n), value: 0n }, d),
      decodeCall({ to: F.PERMIT2_ADDRESS, data: F.permit2ApproveData(F.USDC_MAINNET, F.UNIVERSAL_ROUTER, F.PERMIT2_UNLIMITED, 1_900_000_000), value: 0n }, d),
      decodeCall({ to: F.NFT, data: F.setApprovalForAllData(F.VAULT, false), value: 0n }, d),
    ]);
    const grants = await approvalsFromCalls(calls, d.contracts);
    expect(grants.map((g) => g.standard)).toEqual(["erc20", "erc721-all", "erc721", "permit2"]);
    expect(grants[1]).toMatchObject({ unlimited: true, display: "All HARB" });
    expect(grants[2]).toMatchObject({ amount: "7", display: "HARB #7", unlimited: false });
    expect(grants[3]).toMatchObject({ unlimited: true, spender: F.UNIVERSAL_ROUTER, expiry: "2030-03-17T17:46:40.000Z" });
  });

  it("expands multicall and aggregate3 into inner calls", async () => {
    const d = deps();
    const inner = [F.approveData(F.VAULT, F.usdc(1)), F.transferData(F.EOA_SPENDER, F.usdc(2))];
    const mc = await decodeCall({ to: F.USDC_MAINNET, data: F.multicallData(inner), value: 0n }, d);
    expect(mc.functionName).toBe("multicall");
    expect(mc.inner.map((c) => c.functionName)).toEqual(["approve", "transfer"]);
    expect((await approvalsFromCalls(flattenCalls([mc]), d.contracts))[0]).toMatchObject({ spender: F.VAULT });

    const ag = await decodeCall({ to: F.VAULT, data: F.aggregate3Data([{ target: F.USDC_MAINNET, callData: F.approveData(F.VAULT, F.usdc(3)) }]), value: 0n }, d);
    expect(ag.inner[0]).toMatchObject({ to: F.USDC_MAINNET, functionName: "approve" });
  });

  it("lists Universal Router commands and decodes PERMIT2_PERMIT", async () => {
    const d = deps();
    const permit = encodeAbiParameters(
      parseAbiParameters("((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit, bytes signature"),
      [{ details: { token: F.USDC_MAINNET, amount: F.PERMIT2_UNLIMITED, expiration: 1_900_000_000, nonce: 0 }, spender: F.UNIVERSAL_ROUTER, sigDeadline: 1_900_000_000n }, "0x"],
    );
    const data = encodeFunctionData({ abi: BUILTIN_ABI, functionName: "execute", args: ["0x0a00", [permit, "0x"]] });
    const call = await decodeCall({ to: F.UNIVERSAL_ROUTER, data, value: 0n }, d);
    expect(call.inner.map((c) => c.functionName)).toEqual(["PERMIT2_PERMIT", "V3_SWAP_EXACT_IN"]);
    const grants = await approvalsFromCalls(flattenCalls([call]), d.contracts);
    expect(grants[0]).toMatchObject({ standard: "permit2", unlimited: true, spender: F.UNIVERSAL_ROUTER });
  });

  it("uses the signature database for unknown selectors, and degrades to raw calldata", async () => {
    const withDb = deps({ [SIGDB]: { ok: true, result: { function: { "0xdeadbeef": [{ name: "drain(uint256)", filtered: false }] } } } });
    const call = await decodeCall({ to: F.VAULT, data: F.JUNK_DATA, value: 0n }, withDb);
    expect(call).toMatchObject({ functionName: "drain", abiSource: "signature-db" });
    expect(call.args[0]!.value).toBe("1");

    const noDb = deps();
    const raw = await decodeCall({ to: F.VAULT, data: F.JUNK_DATA, value: 0n }, noDb);
    expect(raw.functionName).toBeUndefined();
    expect(raw).toMatchObject({ abiSource: "none", selector: "0xdeadbeef" });
  });

  it("decodes against the ABI of a verified contract from Sourcify", async () => {
    const abi = [{ type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] }];
    const d = deps({ [`https://sourcify.dev/server/v2/contract/1/${F.VAULT}`]: { abi, compilation: { name: "HarborVault" }, match: "exact_match" } });
    const data = encodeFunctionData({ abi, functionName: "deposit", args: [F.usdc(250), F.WALLET] });
    const call = await decodeCall({ to: F.VAULT, data, value: 0n }, d);
    expect(call).toMatchObject({ functionName: "deposit", abiSource: "sourcify", contractName: "HarborVault" });
  });

  it("typed-data permits become grants with token symbols", async () => {
    const d = deps();
    const grants = await approvalsFromTyped(decodeTypedData(F.permit2TransferFrom(F.USDC_MAINNET, F.usdc(5), F.VAULT)), d.contracts);
    expect(grants[0]).toMatchObject({ standard: "permit2", symbol: "USDC", display: "5 USDC (transfer)" });
  });
});

describe("ui-match rules", () => {
  const usdcGrant = (amount: bigint, unlimited = false) => ({ standard: "erc20" as const, token: F.USDC_MAINNET, symbol: "USDC", spender: F.VAULT, amount: amount.toString(), display: unlimited ? "Unlimited (2²⁵⁶ − 1)" : displayAmount(amount, { symbol: "USDC", decimals: 6 }), unlimited });
  const base = { kind: "transaction" as const, functionName: "approve", approvals: [], outgoing: [], valueWei: 0n, nativeSymbol: "ETH", description: "" };
  const decimals = () => 6;

  it("reads intents and amounts from labels", () => {
    expect(labelIntent("Sign in with Ethereum")).toBe("signin");
    expect(labelIntent("Approve 250 USDC")).toBe("approve");
    expect(labelIntent("Deposit")).toBe("deposit");
    expect(labelIntent("Claim rewards")).toBe("claim");
    expect(labelAmount("Approve 1,250.5 USDC")).toEqual({ amount: 1250.5, symbol: "USDC" });
    expect(labelAmount("Approve")).toBeUndefined();
  });

  it("fails when the label names an amount but the approval is unlimited", () => {
    const r = matchByRules("Approve 250 USDC", { ...base, approvals: [usdcGrant(F.UNLIMITED, true)] }, decimals);
    expect(r).toMatchObject({ status: "fail" });
    expect(r!.detail).toMatch(/250 USDC; the request is unlimited/);
  });

  it("passes on an exact amount and fails on a different one", () => {
    expect(matchByRules("Approve 100 USDC", { ...base, approvals: [usdcGrant(F.usdc(100))] }, decimals)!.status).toBe("pass");
    expect(matchByRules("Approve 100 USDC", { ...base, approvals: [usdcGrant(F.usdc(250))] }, decimals)!.status).toBe("fail");
    expect(matchByRules("Approve 100 DAI", { ...base, approvals: [usdcGrant(F.usdc(100))] }, decimals)!.status).toBe("fail");
  });

  it("fails a sign-in button that is really a permit", () => {
    const r = matchByRules("Sign in", { ...base, kind: "typedData", primaryType: "PermitSingle", approvals: [{ ...usdcGrant(1n), standard: "permit2" }] }, decimals);
    expect(r).toMatchObject({ status: "fail" });
  });

  it("is inconclusive for vague labels and settles plain transactions by verb", () => {
    expect(matchByRules("Continue", { ...base, approvals: [usdcGrant(F.usdc(100))] }, decimals)).toBeUndefined();
    expect(matchByRules("Deposit", { ...base, functionName: "deposit" }, decimals)!.status).toBe("pass");
    expect(matchByRules("Claim", { ...base, functionName: "deposit", valueWei: 10n ** 18n }, decimals)!.status).toBe("fail");
    expect(matchByRules(undefined, base, decimals)).toBeUndefined();
  });

  it("checks the SIWE domain", () => {
    const r = matchByRules("Sign in", { ...base, kind: "message", functionName: undefined, siwe: { domain: "evil.xyz", matchesPage: false, pageHost: "app.harborvault.xyz" } }, decimals);
    expect(r).toMatchObject({ status: "fail" });
  });
});

describe("decodeAbiParameters sanity", () => {
  it("round-trips", () => {
    const enc = encodeAbiParameters(parseAbiParameters("uint256 a"), [5n]);
    expect(decodeAbiParameters(parseAbiParameters("uint256 a"), enc)[0]).toBe(5n);
  });
});
