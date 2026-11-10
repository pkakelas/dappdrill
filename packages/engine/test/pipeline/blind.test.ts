import { describe, expect, it } from "vitest";
import { forkUnseenLine, type WalletRequest } from "@dappdrill/core";
import { blindHosts } from "../../src/pipeline/tests.js";

const HASH = "0x" + "ab".repeat(32);
const sent = (outcome: WalletRequest["outcome"] = "approved", result: unknown = HASH): WalletRequest => ({ id: "r1", method: "eth_sendTransaction", chainId: 1, kind: "sign", at: "", outcome, result });

describe("blindHosts", () => {
  it("is nothing when the test sent no transaction: the page had nothing to miss", () => {
    expect(blindHosts([], () => ["api.app.test"], ["api.app.test"])).toEqual([]);
    expect(blindHosts([sent("rejected", undefined)], () => ["api.app.test"], [])).toEqual([]);
  });

  it("is nothing when no backend was told about the transaction or asked about the wallet", () => {
    expect(blindHosts([sent()], () => [], [])).toEqual([]);
  });

  it("names the backends the page told about the hash, and the ones that reported holdings from the real chain", () => {
    const told = (key: string) => (key === HASH ? ["indexer.app.test"] : []);
    expect(blindHosts([sent()], told, ["balances.app.test", "indexer.app.test"])).toEqual(["indexer.app.test", "balances.app.test"]);
  });

  it("reads as a reason the owner can act on", () => {
    expect(forkUnseenLine(["indexer.app.test"])).toMatch(/^The transaction was mined on the fork, but indexer\.app\.test reads the real chain and never saw it/);
    expect(forkUnseenLine(["a.test", "b.test"])).toContain("a.test, b.test read the real chain");
  });
});
