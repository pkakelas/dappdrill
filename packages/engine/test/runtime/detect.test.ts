import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectChains } from "../../src/chain/detect.js";
import { CHAIN_ID, startFixture, type Fixture } from "./fixture.js";

let fx: Fixture;

beforeAll(async () => {
  fx = await startFixture();
}, 60_000);

afterAll(async () => {
  await fx?.close();
});

describe("detectChains", () => {
  it("finds the chain a dApp reads from by watching its JSON-RPC traffic", async () => {
    const found = await detectChains(fx.pageUrl(), { settleMs: 2_000 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" });
  }, 60_000);
});
