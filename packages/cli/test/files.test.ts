import { describe, expect, it } from "vitest";
import { UsageError, parseChain, parseEdgeCases } from "../src/files.js";

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
