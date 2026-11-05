/**
 * Integration: real mainnet contracts on an Anvil fork this test starts itself.
 * Needs network (public RPC, Sourcify, blocklists). Run with:
 *   DAPPDRILL_FORK_TESTS=1 corepack pnpm --filter @dappdrill/engine exec vitest run test/signing/fork.test.ts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, parseEther, type Hex } from "viem";
import type { SigningReview } from "@dappdrill/core";
import { BUILTIN_ABI } from "../../src/signing/builtin.js";
import { createSigningReviewer } from "../../src/signing/index.js";
import type { SigningInput, SigningReviewer } from "../../src/types.js";
import { AnvilChain, MAINNET_RPC, pinnedBlock } from "./anvil-chain.js";
import * as F from "./fixtures.js";

const enabled = process.env.DAPPDRILL_FORK_TESTS === "1";
const WHALE: Hex = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503"; // a mainnet account; funded on the fork anyway
const SWAP_ROUTER_V3: Hex = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const RANDOM_EOA: Hex = "0x9f3a0be4c2c8a1d0c7d8f1b2e3a4b5c6d7e8f9a0";

describe.skipIf(!enabled)("signing reviewer on a mainnet fork", () => {
  let chain: AnvilChain;
  let reviewer: SigningReviewer;
  const cacheDir = process.env.DAPPDRILL_CACHE_DIR ?? mkdtempSync(join(tmpdir(), "dappdrill-signing-"));

  beforeAll(async () => {
    const forkBlock = await pinnedBlock(MAINNET_RPC);
    console.log(`forking ${MAINNET_RPC} at block ${forkBlock}`);
    chain = await AnvilChain.start({ chainId: 1, upstream: MAINNET_RPC, forkBlock });
    await chain.setBalance(1, WHALE, parseEther("100"));
    reviewer = createSigningReviewer({ cacheDir, lookupTimeoutMs: 20_000 });
  }, 180_000);

  afterAll(async () => {
    await chain?.close();
  });

  const input = (request: SigningInput["request"], ui: SigningInput["ui"], rest: Partial<SigningInput> = {}): SigningInput => ({
    request, chains: chain, ui: { pageUrl: "https://app.uniswap.org/swap", ...ui }, baselines: {}, ...rest,
  });
  const check = (r: SigningReview, id: SigningReview["checks"][number]["id"]) => r.checks.find((c) => c.id === id)!;
  const log = (name: string, r: SigningReview) => {
    const balances = r.simulation?.balanceChanges ?? [];
    console.log(`\n[${name}] ${r.verdict}: ${r.title}\n  ${r.summary}\n  ${r.explanation}\n  ` + r.checks.map((c) => `${c.id}=${c.status}`).join(" ") + (balances.length ? `\n  balances: ${balances.map((b) => b.display).join(", ")}` : "") + `\n  simulation: ${check(r, "simulation").detail}`);
  };

  it("unlimited USDC approve to Permit2 → check (well-known spender, but unlimited)", async () => {
    const r = await reviewer.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.PERMIT2_ADDRESS, F.UNLIMITED), { from: WHALE }), { buttonLabel: "Approve USDC" }));
    log("permit2-unlimited", r);
    expect(r.verdict).toBe("check");
    expect(r.decoded).toMatchObject({ functionName: "approve", abiSource: expect.stringMatching(/sourcify|builtin|erc7730/) });
    expect(r.approvals[0]).toMatchObject({ unlimited: true, symbol: "USDC", spenderName: "Permit2 (Uniswap)" });
    expect(check(r, "approval").status).toBe("warn");
    expect(check(r, "verified-source").status).toBe("pass");
    expect(check(r, "token").detail).toMatch(/real USDC/);
    expect(check(r, "simulation").status).toBe("pass");
    expect(check(r, "simulation").detail).toMatch(/Allowance for 0x0000…8BA3 goes from 0 USDC to Unlimited/);
  }, 120_000);

  it("approve to a random EOA → dangerous", async () => {
    const r = await reviewer.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(RANDOM_EOA, F.usdc(100)), { from: WHALE }), { buttonLabel: "Approve 100 USDC" }));
    log("approve-eoa", r);
    expect(r.verdict).toBe("dangerous");
    expect(check(r, "approval")).toMatchObject({ status: "fail" });
    expect(r.explanation).toMatch(/wallet address/);
  }, 120_000);

  it("'Approve 100 USDC' with an exact 100 USDC approve to Permit2 → consistent", async () => {
    const r = await reviewer.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.PERMIT2_ADDRESS, F.usdc(100)), { from: WHALE }), { buttonLabel: "Approve 100 USDC" }));
    log("approve-exact", r);
    expect(r.verdict).toBe("consistent");
    expect(check(r, "ui-match")).toMatchObject({ status: "pass" });
    expect(check(r, "simulation").status).toBe("pass");
  }, 120_000);

  it("Permit2 PermitSingle presented as 'Sign in' → dangerous", async () => {
    const td = F.permit2Single(F.USDC_MAINNET, F.UNIVERSAL_ROUTER, F.PERMIT2_UNLIMITED, Math.floor(Date.now() / 1000) + 86_400 * 30);
    const r = await reviewer.review(input({ ...F.signRequest("eth_signTypedData_v4", [WHALE, JSON.stringify(td)]), from: WHALE }, { buttonLabel: "Sign in" }));
    log("permit2-signin", r);
    expect(r.verdict).toBe("dangerous");
    expect(r.approvals[0]).toMatchObject({ standard: "permit2", unlimited: true });
    expect(check(r, "ui-match").status).toBe("fail");
    expect(check(r, "erc7730").status).toBe("pass");
  }, 120_000);

  it("WETH deposit of 1 ETH shows the balance changes", async () => {
    const data = encodeFunctionData({ abi: BUILTIN_ABI, functionName: "deposit" });
    const r = await reviewer.review(input(F.txRequest(F.WETH_MAINNET, data, { from: WHALE, value: parseEther("1") }), { buttonLabel: "Wrap 1 ETH" }));
    log("weth-deposit", r);
    expect(r.verdict).toBe("consistent");
    expect(r.title).toMatch(/^Wrap 1 ETH on Wrapped Ether/);
    expect(check(r, "simulation").status).toBe("pass");
    const mine = (r.simulation?.balanceChanges ?? []).filter((b) => b.owner.toLowerCase() === WHALE.toLowerCase());
    const eth = mine.find((b) => b.token === "native")!;
    const weth = mine.find((b) => b.token.toLowerCase() === F.WETH_MAINNET.toLowerCase())!;
    expect(eth.delta).toBe((-parseEther("1")).toString());
    expect(weth).toMatchObject({ delta: parseEther("1").toString(), symbol: "WETH" });
    expect(check(r, "erc7730").status).toBe("pass");
  }, 120_000);

  it("baseline diff: spender changed from Permit2 to the V3 SwapRouter → check", async () => {
    const script = { id: "test_fork", name: "Swap", stepIndex: 1, params: {} };
    const first = await reviewer.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.PERMIT2_ADDRESS, F.usdc(250)), { from: WHALE }), { buttonLabel: "Approve 250 USDC" }, { script }));
    const second = await reviewer.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(SWAP_ROUTER_V3, F.usdc(250)), { from: WHALE }), { buttonLabel: "Approve 250 USDC" }, { script, baselines: { [first.fingerprint]: first } }));
    log("baseline-diff", second);
    expect(first.verdict).toBe("consistent");
    expect(second.verdict).toBe("check");
    expect(second.baseline?.changes).toEqual([{ field: "spender", before: F.PERMIT2_ADDRESS.toLowerCase(), after: SWAP_ROUTER_V3.toLowerCase() }]);
    expect(second.explanation).toContain("Different spender from the last run");
  }, 180_000);

  it("a reverting call reports the revert", async () => {
    // transferFrom with no allowance reverts on USDC.
    const data = encodeFunctionData({ abi: BUILTIN_ABI, functionName: "transferFrom", args: [RANDOM_EOA, WHALE, F.usdc(1)] });
    const r = await reviewer.review(input(F.txRequest(F.USDC_MAINNET, data, { from: WHALE }), { buttonLabel: "Collect" }));
    log("revert", r);
    expect(check(r, "simulation")).toMatchObject({ status: "warn" });
    expect(check(r, "simulation").detail).toMatch(/Reverts on the fork/);
    expect(r.verdict).toBe("check");
  }, 120_000);
});
