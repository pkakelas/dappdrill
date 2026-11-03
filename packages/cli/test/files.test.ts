import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScanReport } from "@dappdrill/core";
import { UsageError, loadReport, parseChain, parseEdgeCases, parseToken } from "../src/files.js";

describe("parseChain", () => {
  it("fills in the RPC of a known chain", () => {
    expect(parseChain("8453")).toMatchObject({ id: 8453, name: "Base", mode: "fork" });
    expect(parseChain("8453").rpcUrl).toMatch(/^https:/);
  });

  it("runs chains that can't be forked live", () => {
    expect(parseChain("129302")).toMatchObject({ id: 129302, mode: "live" });
  });

  it("keeps an explicit RPC, including one with '=' in it", () => {
    expect(parseChain("999=https://rpc.example/?key=abc").rpcUrl).toBe("https://rpc.example/?key=abc");
  });

  it("rejects bad ids and unknown chains without an RPC", () => {
    expect(() => parseChain("base")).toThrow(UsageError);
    expect(() => parseChain("999")).toThrow(/pass its RPC/);
  });
});

describe("parseEdgeCases", () => {
  it("accepts known ids, trimming spaces", () => {
    expect(parseEdgeCases("happy, reject")).toEqual(["happy", "reject"]);
  });

  it("names the unknown ones", () => {
    expect(() => parseEdgeCases("happy,nope")).toThrow(/Unknown edge case\(s\): nope/);
  });
});

describe("parseToken", () => {
  it("reads chain, token and a whole-token amount", () => {
    expect(parseToken("1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48=5000.5")).toEqual({
      chainId: 1,
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amount: "5000.5",
    });
  });

  it("rejects anything else", () => {
    expect(() => parseToken("1:usdc=5")).toThrow(UsageError);
    expect(() => parseToken("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48=5")).toThrow(/expected <chain id>/);
  });
});

describe("loadReport", () => {
  it("reads back a saved report whose wallet requests had no params", async () => {
    const at = "2026-11-03T00:00:00.000Z";
    const request = { id: "req_1", method: "eth_accounts", params: undefined, chainId: 1, kind: "other", at, outcome: "approved" };
    const run = { id: "run_1", flowId: "flow_1", edgeCase: "happy", status: "pass", walletRequests: [request], startedAt: at, finishedAt: at };
    const report = { url: "https://app.example", startedAt: at, finishedAt: at, chains: [], flows: [], runs: [run], issues: [], signingReviews: [] };
    const path = join(await mkdtemp(join(tmpdir(), "dappdrill-")), "report.json");
    await writeFile(path, JSON.stringify(report)); // drops the undefined params key, as the CLI's writeJson does
    const loaded = await loadReport(path, ScanReport);
    expect(loaded.runs[0]?.walletRequests[0]?.method).toBe("eth_accounts");
  });
});
