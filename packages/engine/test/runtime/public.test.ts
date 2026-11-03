/**
 * Tests against public infrastructure: a Base fork through a public RPC and
 * a real dApp's connect modal. Off by default (rate limits, network); run with
 *   DAPPDRILL_NET=1 corepack pnpm exec vitest run test/runtime/public.test.ts
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { readBalance } from "../../src/chain/deal-erc20.js";
import { rpcCall } from "../../src/chain/rpc.js";
import { createSession } from "../../src/browser/session.js";

const BASE = 8453;
const BASE_RPC = "https://base-rpc.publicnode.com";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // proxy (FiatTokenV2)
const HOLDER = "0x00000000000000000000000000000000d4bbd211"; // nobody's address
const at = (url: string) => (m: string, p: unknown[]) => rpcCall(url, m, p);

const net = process.env.DAPPDRILL_NET === "1";

describe.skipIf(!net)("public chain fork", () => {
  let chains: ChainController;

  beforeAll(async () => {
    chains = await startChains([{ id: BASE, rpcUrl: BASE_RPC, mode: "fork" }], { log: (m) => console.log("  " + m) });
  }, 120_000);

  afterAll(async () => {
    await chains?.close();
  });

  it("forks Base at a pinned block and deals real USDC through the proxy's storage", async () => {
    const cfg = chains.configs()[0]!;
    expect(cfg.forkBlock).toMatch(/^\d+$/);
    const fork = chains.rpcUrl(BASE);
    expect(fork).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await chains.request(BASE, "eth_chainId", [])).toBe("0x2105");
    // the fork sits at the pinned block
    expect(BigInt((await chains.request(BASE, "eth_blockNumber", [])) as string)).toBe(BigInt(cfg.forkBlock!));

    const before = await readBalance(at(BASE_RPC), USDC, HOLDER);
    expect(await readBalance(at(fork), USDC, HOLDER)).toBe(before);
    const amount = 1_234_567_000n; // 1234.567 USDC
    await chains.dealErc20(BASE, USDC, HOLDER, amount);
    expect(await readBalance(at(fork), USDC, HOLDER)).toBe(amount);
    // the real chain is untouched
    expect(await readBalance(at(BASE_RPC), USDC, HOLDER)).toBe(before);
    console.log(`  Base fork at block ${cfg.forkBlock}: dealt ${amount} USDC to ${HOLDER}`);
  }, 120_000);

  it("routes a page's JSON-RPC calls for Base to the fork", async () => {
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-public-"));
    const target = DrillTarget.parse({ url: "https://example.com", chains: [{ id: BASE, rpcUrl: BASE_RPC }] });
    const session = await createSession(target, chains, { artifactsDir, sink: async () => {}, video: false, trace: false });
    try {
      await session.page.goto("https://example.com");
      const got = await session.page.evaluate(async (rpc) => {
        const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
        return (await res.json()).result as string;
      }, BASE_RPC);
      expect(BigInt(got)).toBe(BigInt(chains.configs()[0]!.forkBlock!));
      expect(session.rpc.some((r) => r.chainId === BASE && r.method === "eth_blockNumber" && r.via === "page")).toBe(true);
    } finally {
      await session.close();
    }
  }, 120_000);
});

describe.skipIf(!net)("real dApp smoke (read-only)", () => {
  it("shows the injected wallet in Uniswap's connect modal via EIP-6963", async () => {
    const chains = await startChains([{ id: BASE, rpcUrl: BASE_RPC, mode: "fork" }], {});
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
