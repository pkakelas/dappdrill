import { describe, expect, it } from "vitest";
import { maxUint256 } from "viem";
import type { WalletRequest } from "@dappdrill/core";
import { decodeWalletRequest, matchTypedAmount } from "../../src/agent/wallet-decode.js";

const req = (method: string, params: unknown): WalletRequest => ({
  id: "req_1", method, params, chainId: 1, kind: "sign", at: "now", outcome: "pending",
});
const VAULT = "0x1111111111111111111111111111111111111111";
const pad = (n: bigint | string) => (typeof n === "bigint" ? n.toString(16) : n.replace(/^0x/, "")).padStart(64, "0");

describe("decodeWalletRequest", () => {
  it("decodes an ERC-20 approve with spender and amount", () => {
    const data = `0x095ea7b3${pad(VAULT)}${pad(12_500_000n)}`;
    const d = decodeWalletRequest(req("eth_sendTransaction", [{ to: "0x2222222222222222222222222222222222222222", data }]));
    expect(d.kind).toBe("transaction");
    expect(d.expectation).toEqual({ kind: "transaction", to: "0x2222222222222222222222222222222222222222", functionName: "approve", spenderMustBe: VAULT, failIfUnlimited: true });
    expect(d.amounts).toEqual([12_500_000n]);
    expect(d.summary).toContain("approve(0x1111…1111, 12500000)");
  });

  it("flags unlimited approvals", () => {
    const data = `0x095ea7b3${pad(VAULT)}${pad(maxUint256)}`;
    const d = decodeWalletRequest(req("eth_sendTransaction", [{ to: "0x22", data }]));
    expect(d.unlimitedApproval).toBe(true);
    // Recorded as it is, so the test still replays; the signing review reports it.
    expect(d.expectation.failIfUnlimited).toBeUndefined();
    expect(d.summary).toContain("MAX_UINT256");
  });

  it("falls back to the selector for unknown functions and keeps value", () => {
    const d = decodeWalletRequest(req("eth_sendTransaction", [{ to: VAULT, data: "0xdeadbeef00", value: "0x2386f26fc10000" }]));
    expect(d.expectation.functionName).toBe("0xdeadbeef");
    expect(d.amounts).toEqual([10_000_000_000_000_000n]);
  });

  it("decodes personal_sign text", () => {
    const hex = "0x" + Buffer.from("Sign in to Tiny Vault").toString("hex");
    const d = decodeWalletRequest(req("personal_sign", [hex, "0xaa"]));
    expect(d.kind).toBe("message");
    expect(d.summary).toContain("Sign in to Tiny Vault");
  });

  it("reads spender and amount out of a Permit2 typed-data signature", () => {
    const typed = {
      primaryType: "PermitSingle",
      domain: { name: "Permit2" },
      message: { details: { token: "0x22", amount: "5000000", expiration: "1", nonce: "0" }, spender: VAULT, sigDeadline: "1" },
    };
    const d = decodeWalletRequest(req("eth_signTypedData_v4", ["0xaa", JSON.stringify(typed)]));
    expect(d.kind).toBe("typedData");
    expect(d.expectation.spenderMustBe).toBe(VAULT);
    expect(d.amounts).toContain(5_000_000n);
    expect(d.expectation.failIfUnlimited).toBe(true);
  });

  it("says each request in words, for its owner", () => {
    const TOKEN = "0x2222222222222222222222222222222222222222";
    const words = (method: string, params: unknown) => decodeWalletRequest(req(method, params)).words;
    const sent = (tx: object) => words("eth_sendTransaction", [{ to: TOKEN, ...tx }]);
    const typed = (primaryType: string, message: object) => words("eth_signTypedData_v4", ["0xaa", JSON.stringify({ primaryType, domain: { name: "USD Coin" }, message })]);

    expect(sent({ data: `0x095ea7b3${pad(VAULT)}${pad(12_500_000n)}` })).toBe("approve 0x1111…1111 to spend 12500000 of the token at 0x2222…2222");
    expect(sent({ data: `0x095ea7b3${pad(VAULT)}${pad(maxUint256)}` })).toBe("approve 0x1111…1111 to spend an unlimited amount of the token at 0x2222…2222");
    expect(sent({ data: `0xb6b55f25${pad(5_000_000n)}` })).toBe("call deposit(5000000) on 0x2222…2222");
    expect(sent({ data: "0xdeadbeef00", value: "0x2386f26fc10000" })).toBe("send 0x2222…2222 a call we can't read (0xdeadbeef), with 0.01 of the chain's coin");
    expect(sent({ value: "0x2386f26fc10000" })).toBe("send 0.01 of the chain's coin to 0x2222…2222");
    expect(words("personal_sign", ["0x" + Buffer.from("Sign in to Tiny Vault").toString("hex"), "0xaa"])).toBe("sign the message “Sign in to Tiny Vault”");
    expect(typed("Permit", { owner: "0xaa", spender: VAULT, value: "5000000", nonce: "0", deadline: "1794581262" })).toBe("sign a Permit (USD Coin) that lets 0x1111…1111 spend 5000000");
    expect(typed("Permit", { owner: "0xaa", spender: VAULT, value: maxUint256.toString() })).toBe("sign a Permit (USD Coin) that lets 0x1111…1111 spend an unlimited amount");
    expect(typed("Order", { maker: VAULT, size: "3" })).toBe("sign an Order (USD Coin): maker 0x1111…1111, size 3");
    expect(words("wallet_switchEthereumChain", [{ chainId: "0x1" }])).toBe("answer wallet_switchEthereumChain");
  });

  it("says an amount in the token's units once they are given, and names the token to read them of", () => {
    const TOKEN = "0x2222222222222222222222222222222222222222";
    const usdc = { decimals: 6, symbol: "USDC" };
    const sent = (data: string, units?: { decimals: number; symbol?: string }) => decodeWalletRequest(req("eth_sendTransaction", [{ to: TOKEN, data }]), units);
    const typed = (primaryType: string, domain: object, message: object, units?: { decimals: number; symbol?: string }) => decodeWalletRequest(req("eth_signTypedData_v4", ["0xaa", JSON.stringify({ primaryType, domain, message })]), units);

    const approve = `0x095ea7b3${pad(VAULT)}${pad(12_500_000n)}`;
    expect(sent(approve).token).toBe(TOKEN);
    expect(sent(approve, usdc).words).toBe("approve 0x1111…1111 to spend 12.5 USDC");
    expect(sent(approve, { decimals: 6 }).words).toBe("approve 0x1111…1111 to spend 12.5 of the token at 0x2222…2222");
    expect(sent(`0x095ea7b3${pad(VAULT)}${pad(maxUint256)}`, usdc).words).toBe("approve 0x1111…1111 to spend an unlimited amount of USDC");
    expect(sent(`0xa9059cbb${pad(VAULT)}${pad(1n)}`).words).toBe("transfer 1 of the token at 0x2222…2222 to 0x1111…1111");
    expect(sent(`0xa9059cbb${pad(VAULT)}${pad(1n)}`, usdc).words).toBe("transfer 0.000001 USDC to 0x1111…1111");
    // A deposit doesn't say which token its amount is of, so it stays as the request has it.
    expect(sent(`0xb6b55f25${pad(5_000_000n)}`, usdc)).toMatchObject({ token: undefined, words: "call deposit(5000000) on 0x2222…2222" });

    const permit = { owner: "0xaa", spender: VAULT, value: "5000000" };
    expect(typed("Permit", { name: "USD Coin", verifyingContract: TOKEN.toUpperCase().replace("0X", "0x") }, permit).token).toBe(TOKEN);
    expect(typed("Permit", { name: "USD Coin", verifyingContract: TOKEN }, permit, usdc).words).toBe("sign a Permit (USD Coin) that lets 0x1111…1111 spend 5 USDC");
    // Permit2 is verified by its own contract and names the token in the message.
    const single = typed("PermitSingle", { name: "Permit2", verifyingContract: VAULT }, { details: { token: TOKEN, amount: "5000000" }, spender: VAULT }, usdc);
    expect(single).toMatchObject({ token: TOKEN, words: "sign a PermitSingle (Permit2) that lets 0x1111…1111 spend 5 USDC" });
    expect(typed("Order", { name: "Exchange", verifyingContract: VAULT }, { maker: VAULT, size: "3" }).token).toBeUndefined();
  });
});

describe("matchTypedAmount", () => {
  it("finds the typed value and its decimals", () => {
    expect(matchTypedAmount(["abc", "12.5"], [12_500_000n])).toEqual({ typed: "12.5", decimals: 6 });
    expect(matchTypedAmount(["0.01"], [10_000_000_000_000_000n])).toEqual({ typed: "0.01", decimals: 18 });
    expect(matchTypedAmount(["1,000"], [1_000_000_000_000_000_000_000n])).toEqual({ typed: "1,000", decimals: 18 });
    expect(matchTypedAmount(["3"], [12_500_000n])).toBeUndefined();
  });
});
