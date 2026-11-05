import { describe, expect, it } from "vitest";
import type { WalletRequest } from "@dappdrill/core";
import { describeRequest } from "../../src/agent/tools.js";

const request = (over: Partial<WalletRequest>) =>
  ({ id: "req_1", at: "2026-11-05T10:00:00.000Z", wallet: "metamask", chainId: 1, method: "eth_accounts", params: [], kind: "other", outcome: "approved", ...over }) as WalletRequest;

describe("describeRequest", () => {
  it("shows what a read returned, so an empty account list isn't taken for a connection", () => {
    expect(describeRequest(request({ result: [] }))).toBe("- req_1 eth_accounts → returned []");
  });

  it("keeps the outcome for a connect", () => {
    expect(describeRequest(request({ method: "eth_requestAccounts", kind: "connect" }))).toBe("- req_1 eth_requestAccounts → approved");
  });

  it("says when a read returned nothing", () => {
    expect(describeRequest(request({ method: "wallet_getCapabilities" }))).toBe("- req_1 wallet_getCapabilities → returned null");
  });
});
