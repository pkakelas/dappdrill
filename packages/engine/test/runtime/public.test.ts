/**
 * Tests against public infrastructure: Base through a public RPC and a real
 * dApp's connect modal. Off by default (rate limits, network); run with
 *   DAPPDRILL_NET=1 corepack pnpm exec vitest run test/runtime/public.test.ts
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession } from "../../src/browser/session.js";

const BASE = 8453;
const BASE_RPC = "https://base-rpc.publicnode.com";

const net = process.env.DAPPDRILL_NET === "1";

describe.skipIf(!net)("public chain", () => {
  let chains: ChainController;

  beforeAll(() => {
    chains = startChains([{ id: BASE, rpcUrl: BASE_RPC }], { log: (m) => console.log("  " + m) });
  });

  afterAll(async () => {
    await chains?.close();
  });

  it("reaches Base through its own RPC", async () => {
    expect(chains.rpcUrl(BASE)).toBe(BASE_RPC);
    expect(await chains.request(BASE, "eth_chainId", [])).toBe("0x2105");
    expect(await chains.client(BASE).getBlockNumber()).toBeGreaterThan(0n);
  }, 120_000);

  it("records a page's JSON-RPC calls for Base", async () => {
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-public-"));
    const target = DrillTarget.parse({ url: "https://example.com", chains: [{ id: BASE, rpcUrl: BASE_RPC }] });
    const session = await createSession(target, chains, { artifactsDir, sink: async () => {}, video: false, trace: false });
    try {
      await session.page.goto("https://example.com");
      const got = await session.page.evaluate(async (rpc) => {
        const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
        return (await res.json()).result as string;
      }, BASE_RPC);
      expect(BigInt(got)).toBeGreaterThan(0n);
      await expect.poll(() => session.rpc.some((r) => r.chainId === BASE && r.method === "eth_blockNumber" && r.via === "page")).toBe(true);
    } finally {
      await session.close();
    }
  }, 120_000);
});

describe.skipIf(!net)("real dApp smoke (read-only)", () => {
  it("shows the injected wallet in Uniswap's connect modal via EIP-6963", async () => {
    const chains = startChains([{ id: BASE, rpcUrl: BASE_RPC }], {});
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-uniswap-"));
    const target = DrillTarget.parse({ url: "https://app.uniswap.org", chains: [{ id: BASE, rpcUrl: BASE_RPC }] });
    const session = await createSession(target, chains, { artifactsDir, sink: async () => {}, video: false, trace: false, startChainId: BASE });
    try {
      await session.page.goto("https://app.uniswap.org/swap", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await session.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const connect = session.page.getByRole("button", { name: /^Connect$/i }).first();
      await connect.waitFor({ timeout: 30_000 });
      await connect.click();
      const metamask = session.page.getByText("MetaMask", { exact: true }).first();
      await metamask.waitFor({ timeout: 20_000 });
      const shot = await session.screenshot("uniswap-connect-modal");
      console.log(`  Uniswap connect modal lists MetaMask; screenshot ${path.join(artifactsDir, shot)}`);
      expect(await metamask.isVisible()).toBe(true);
      // nothing was signed or sent
      expect(session.wallet.requests().filter((r) => r.kind === "sign")).toHaveLength(0);
    } finally {
      await session.close();
      await chains.close();
    }
  }, 180_000);
});
