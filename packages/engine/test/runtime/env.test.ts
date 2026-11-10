import { describe, expect, it } from "vitest";
import type { ChainConfig } from "@dappdrill/core";
import { freshAccounts, liveChainLine, withoutFallback } from "../../src/pipeline/env.js";

const eth: ChainConfig = { id: 1, name: "Ethereum", rpcUrl: "https://eth.example", mode: "fork", fallback: true };
const pod: ChainConfig = { id: 129302, rpcUrl: "https://rpc.pod.example", mode: "live", fromApp: true };

describe("withoutFallback", () => {
  it("drops the Ethereum fallback once the app's own chain is known", () => {
    expect(withoutFallback([eth, pod])).toEqual([pod]);
  });
  it("keeps it when it's the only chain", () => {
    expect(withoutFallback([eth])).toEqual([eth]);
    expect(withoutFallback([])).toEqual([]);
  });
});

describe("freshAccounts", () => {
  it("gives new accounts on a live chain with no funded key", () => {
    const a = freshAccounts(true, {});
    const b = freshAccounts(true, {});
    expect(a?.A).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a?.A).not.toBe(b?.A);
    expect(a?.A).not.toBe(a?.B);
  });
  it("keeps the saved accounts on forks, or when a funded key is set", () => {
    expect(freshAccounts(false, {})).toBeUndefined();
    expect(freshAccounts(true, { liveKey: `0x${"1".repeat(64)}` })).toBeUndefined();
  });
});

describe("liveChainLine", () => {
  it("says what a run on a live network can and can't do", () => {
    expect(liveChainLine(pod, "none")).toMatch(/^Chain 129302 can't be forked, and with no funded key or way to get test funds the wallet won't sign in there/);
    expect(liveChainLine(pod, "funding")).toMatch(/with a new account that gets test funds the way you described$/);
    expect(liveChainLine({ ...pod, name: "Pod" }, "key")).toBe("Pod (chain 129302) can't be forked, so this run uses its live network with your funded key");
  });
});
