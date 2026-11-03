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
    expect(d.expectation).toEqual({ kind: "transaction", to: "0x2222222222222222222222222222222222222222", functionName: "approve", spenderMustBe: VAULT });
    expect(d.amounts).toEqual([12_500_000n]);
    expect(d.summary).toContain("approve(0x1111…1111, 12500000)");
  });

  it("flags unlimited approvals", () => {
    const data = `0x095ea7b3${pad(VAULT)}${pad(maxUint256)}`;
    const d = decodeWalletRequest(req("eth_sendTransaction", [{ to: "0x22", data }]));
    expect(d.unlimitedApproval).toBe(true);
    expect(d.expectation.failIfUnlimited).toBe(true);
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
