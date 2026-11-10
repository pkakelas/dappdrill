import { describe, expect, it } from "vitest";
import { fundsNeeded, liveShortfall, shortfallLine } from "../../src/pipeline/funds.js";
import type { ChainController } from "../../src/types.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const GWEI = 1_000_000_000n;

function chains(balance: bigint, gasPrice = GWEI): ChainController {
  return {
    configs: () => [
      { id: 1, name: "Ethereum", rpcUrl: "http://fork", mode: "fork" },
      { id: 129302, name: "pod", rpcUrl: "http://live", mode: "live" },
    ],
    client: () => ({ getBalance: async () => balance, getGasPrice: async () => gasPrice }) as never,
  } as unknown as ChainController;
}

describe("liveShortfall", () => {
  it("needs gas for a handful of transactions at the chain's price", () => {
    expect(fundsNeeded(GWEI)).toBe(GWEI * 300_000n * 5n);
  });

  it("is nothing without a funded key: a fresh account was never meant to pay", async () => {
    expect(await liveShortfall(chains(0n), undefined)).toBeUndefined();
  });

  it("is nothing when the wallet can pay", async () => {
    expect(await liveShortfall(chains(10n ** 18n), KEY)).toBeUndefined();
  });

  it("names the live chain, the wallet and both figures when it can't", async () => {
    const short = await liveShortfall(chains(1_000n * GWEI), KEY);
    expect(short?.chain.id).toBe(129302);
    expect(short?.address).toBe(ADDRESS);
    expect(shortfallLine(short!)).toBe("The funded wallet 0x7099…79C8 holds 0.000001 ETH on pod; about 0.0015 ETH is needed for a run. Add funds to it.");
  });
});
