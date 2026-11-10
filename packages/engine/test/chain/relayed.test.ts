import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pad } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { copyBehindLine } from "@dappdrill/core";
import { loggedSince, startOfWatch } from "../../src/chain/relayed.js";
import type { ChainController, Hex } from "../../src/types.js";
import { Wallet } from "../../src/wallet/controller.js";

const token = "0x8bcb60668edcfb4523b5e75c7e7f66bb9d4743dd" as Hex;
const owner = "0x5bff2ba0b292823f7cbb4424cb52f1c1279a4d8a" as Hex;

/** A real chain where `token` logged `owner` as the first indexed topic, from block 0x200 on. */
let server: Server;
let url = "";
const asked: unknown[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      asked.push({ method, params });
      let result: unknown = null;
      if (method === "eth_blockNumber") result = "0x220";
      if (method === "eth_getLogs") {
        const [f] = params;
        const hit = f.address === token && f.topics[1] === pad(owner) && BigInt(f.fromBlock) <= 0x200n;
        result = hit ? [{ address: token, topics: ["0x8c5b", pad(owner)], data: "0x" }] : [];
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("the real-chain check", () => {
  it("starts a little before the real head, at the first RPC that answers", async () => {
    expect(await startOfWatch(["http://127.0.0.1:1", url])).toEqual({ rpcUrl: url, block: 0x220n - 20n });
    expect(await startOfWatch(["http://127.0.0.1:1"])).toBeUndefined();
  });

  it("finds the signed contract logging our account, in any indexed topic, and nothing else", async () => {
    expect(await loggedSince(url, token, owner, 0x1f0n)).toBe(true);
    expect(await loggedSince(url, token, owner, 0x210n)).toBe(false);
    expect(await loggedSince(url, token, privateKeyToAccount(generatePrivateKey()).address, 0x1f0n)).toBe(false);
    expect(await loggedSince(url, "0x0000000000000000000000000000000000000001", owner, 0x1f0n)).toBe(false);
  });
});

/** A permit bound to `chainId`, for `verifyingContract`. */
const permit = (from: string, chainId: number) => [
  from,
  JSON.stringify({
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      Permit: [{ name: "owner", type: "address" }, { name: "value", type: "uint256" }],
    },
    primaryType: "Permit",
    domain: { name: "TestUSDC", chainId, verifyingContract: token },
    message: { owner: from, value: "50000000" },
  }),
];

/** pod's shape: a live chain, a copy of a testnet, and a copy of Ethereum mainnet. */
function chains(watch: ChainController["watchSignature"]): ChainController {
  const modes: Record<number, "fork" | "live"> = { 129302: "live", 421614: "fork", 1: "fork" };
  return {
    configs: () => Object.entries(modes).map(([id, mode]) => ({ id: Number(id), rpcUrl: "http://x", mode })),
    has: (id: number) => id in modes,
    mode: (id: number) => modes[id]!,
    watchSignature: watch,
  } as unknown as ChainController;
}

describe("signing typed data on a copy", () => {
  const ctx = { pageUrl: "https://app.example", clickSeq: 0 };
  const sign = (wallet: Wallet, chainId: number) => wallet.handle({ wallet: "metamask", method: "eth_signTypedData_v4", params: permit(wallet.address(), chainId) }, ctx);

  it("watches what was signed on a copy, so the run learns when the app used it on the real chain", async () => {
    const watch = vi.fn();
    const wallet = new Wallet({ profile: "metamask", chains: chains(watch), liveKey: generatePrivateKey(), startChainId: 421614, connected: true, policy: { autoSign: true } });
    const res = await sign(wallet, 421614);
    expect(res.result).toMatch(/^0x[0-9a-f]{130}$/);
    expect(watch).toHaveBeenCalledWith(421614, token, wallet.address());
  });

  it("won't sign for a copied mainnet with the owner's key, but does with an account of ours", async () => {
    const watch = vi.fn();
    const own = new Wallet({ profile: "metamask", chains: chains(watch), liveKey: generatePrivateKey(), startChainId: 1, connected: true, policy: { autoSign: true } });
    expect((await sign(own, 1)).error?.message).toMatch(/won't sign for Ethereum with your own key/);
    expect(watch).not.toHaveBeenCalled();
    const ours = new Wallet({ profile: "metamask", chains: chains(watch), startChainId: 1, connected: true, policy: { autoSign: true } });
    expect((await sign(ours, 1)).result).toMatch(/^0x/);
  });

  it("says why a failed test on a copy that fell behind isn't the app's", () => {
    expect(copyBehindLine(["Arbitrum Sepolia"])).toBe(
      "After our wallet signed on the copy of Arbitrum Sepolia, the app's server acted for it on the real chain, which the copy never sees, so the copy was behind the real chain for the rest of this run. The next run copies Arbitrum Sepolia at its latest block: run the test again.",
    );
  });
});
