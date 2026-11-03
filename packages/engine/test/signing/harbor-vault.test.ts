/**
 * The seeded signing bugs of fixtures/harbor-vault (bugs 1, 2 and 8), replayed
 * against the fixture's own contracts deployed on a fresh Anvil this test
 * starts on a free port. Needs the fixture's forge artifacts (`forge build`
 * in fixtures/harbor-vault); skipped when they aren't there.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, encodeFunctionData, http, maxUint256, parseAbi, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SigningReview } from "@dappdrill/core";
import { createSigningReviewer } from "../../src/signing/index.js";
import type { SigningInput, SigningReviewer } from "../../src/types.js";
import { AnvilChain } from "./anvil-chain.js";
import { BLOCKLISTS, fakeFetch } from "./fake-fetch.js";
import * as F from "./fixtures.js";

const FIXTURE = join(import.meta.dirname, "../../../../fixtures/harbor-vault");
const artifactPath = (name: string) => join(FIXTURE, "out", `${name}.sol`, `${name}.json`);
const ready = ["HUSDC", "HarborVault", "Helper"].every((n) => existsSync(artifactPath(n)));

const CHAIN_ID = 31337;
const PAGE = "http://127.0.0.1:5173/vault";
// Anvil's well-known dev accounts (mnemonic "test test ... junk"): 0 deploys, 1 is the user.
const DEPLOYER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const vaultAbi = parseAbi(["function deposit(uint256 assets, address receiver) returns (uint256)"]);
const faucetAbi = parseAbi(["function mint(address to, uint256 amount)"]);

describe.skipIf(!ready)("harbor-vault seeded signing bugs", () => {
  let chain: AnvilChain;
  let reviewer: SigningReviewer;
  const contracts = {} as { hUSDC: Address; HarborVault: Address; Helper: Address };

  beforeAll(async () => {
    chain = await AnvilChain.start({ chainId: CHAIN_ID });
    const deployer = privateKeyToAccount(DEPLOYER_KEY);
    const wallet = createWalletClient({ account: deployer, transport: http(chain.rpcUrl()) });
    const client = chain.client();
    const deploy = async (name: string, args: unknown[] = []): Promise<Address> => {
      const json = JSON.parse(readFileSync(artifactPath(name), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
      const hash = await wallet.deployContract({ abi: json.abi, bytecode: json.bytecode.object, args, chain: null });
      return (await client.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    contracts.hUSDC = await deploy("HUSDC");
    contracts.HarborVault = await deploy("HarborVault", [contracts.hUSDC]);
    contracts.Helper = await deploy("Helper");
    const mint = await wallet.writeContract({ address: contracts.hUSDC, abi: faucetAbi, functionName: "mint", args: [USER, F.usdc(1000)], chain: null });
    await client.waitForTransactionReceipt({ hash: mint });
    // Offline: a dev chain has nothing on Sourcify, and the blocklists don't know these addresses.
    reviewer = createSigningReviewer({ fetch: fakeFetch(BLOCKLISTS()), lookupTimeoutMs: 5000 });
  }, 120_000);

  afterAll(async () => {
    await chain?.close();
  });

  const input = (request: SigningInput["request"], ui: SigningInput["ui"]): SigningInput => ({ request, chains: chain, ui: { pageUrl: PAGE, ...ui }, baselines: {} });
  const check = (r: SigningReview, id: SigningReview["checks"][number]["id"]) => r.checks.find((c) => c.id === id)!;
  const log = (name: string, r: SigningReview) =>
    console.log(`\n[${name}] ${r.verdict}: ${r.title}\n  ${r.summary}\n  ${r.explanation}\n  ` + r.checks.map((c) => `${c.id}=${c.status}`).join(" ") + `\n  simulation: ${check(r, "simulation").detail}`);
  const tx = (to: Address, data: Hex) => F.txRequest(to, data, { from: USER, chainId: CHAIN_ID });

  it("bug 1: 'Approve 100 hUSDC' sends an unlimited approval → dangerous", async () => {
    const r = await reviewer.review(input(tx(contracts.hUSDC, F.approveData(contracts.HarborVault, maxUint256)), { buttonLabel: "Approve 100 hUSDC" }));
    log("bug1", r);
    expect(r.verdict).toBe("dangerous");
    expect(r.approvals[0]).toMatchObject({ symbol: "hUSDC", unlimited: true });
    expect(check(r, "ui-match")).toMatchObject({ status: "fail" });
    expect(r.explanation).toContain("Unlimited where the UI shows 100");
    expect(check(r, "simulation").status).toBe("pass");
  }, 60_000);

  it("a wallet drained of gas (the low-gas edge case) still simulates what the call does", async () => {
    await chain.setBalance(CHAIN_ID, USER, 0n);
    try {
      const r = await reviewer.review(input(tx(contracts.hUSDC, F.approveData(contracts.HarborVault, F.usdc(100))), { buttonLabel: "Approve 100 hUSDC" }));
      expect(check(r, "simulation").status).toBe("pass");
      expect(r.simulation?.balanceChanges.filter((b) => b.token === "native")).toEqual([]);
      expect(await chain.client().getBalance({ address: USER })).toBe(0n);
    } finally {
      await chain.setBalance(CHAIN_ID, USER, 10n ** 20n);
    }
  });

  it("fixed: 'Approve 100 hUSDC' with exactly 100 → consistent; a dev chain has no source to verify", async () => {
    const r = await reviewer.review(input(tx(contracts.hUSDC, F.approveData(contracts.HarborVault, F.usdc(100))), { buttonLabel: "Approve 100 hUSDC" }));
    log("fixed-approve", r);
    expect(r.checks.filter((c) => c.status === "fail" || c.status === "warn")).toEqual([]);
    expect(check(r, "ui-match").status).toBe("pass");
    expect(check(r, "verified-source")).toMatchObject({ status: "skip" });
    expect(check(r, "verified-source").detail).toMatch(/local dev chain/);
    expect(check(r, "simulation").status).toBe("pass");
    expect(r.verdict).toBe("consistent");
  }, 60_000);

  it("bug 2: 'Claim rewards' asks to approve the Helper → dangerous", async () => {
    const r = await reviewer.review(input(tx(contracts.hUSDC, F.approveData(contracts.Helper, F.usdc(10))), { pageUrl: "http://127.0.0.1:5173/rewards", buttonLabel: "Claim rewards" }));
    log("bug2", r);
    expect(r.verdict).toBe("dangerous");
    expect(check(r, "ui-match")).toMatchObject({ status: "fail" });
    expect(r.approvals[0]?.spender.toLowerCase()).toBe(contracts.Helper.toLowerCase());
  }, 60_000);

  it("bug 8: 'Sign in' is an unlimited hUSDC Permit to the Helper → dangerous", async () => {
    const td = {
      domain: { name: "Harbor USD", version: "1", chainId: CHAIN_ID, verifyingContract: contracts.hUSDC },
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
        Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
      },
      primaryType: "Permit",
      message: { owner: USER, spender: contracts.Helper, value: maxUint256.toString(), nonce: "0", deadline: String(Math.floor(Date.now() / 1000) + 30 * 86_400) },
    };
    const r = await reviewer.review(input({ ...F.signRequest("eth_signTypedData_v4", [USER, JSON.stringify(td)], CHAIN_ID), from: USER }, { pageUrl: "http://127.0.0.1:5173/", buttonLabel: "Sign in" }));
    log("bug8", r);
    expect(r.verdict).toBe("dangerous");
    expect(r.decoded).toMatchObject({ kind: "typedData", primaryType: "Permit" });
    expect(r.approvals[0]).toMatchObject({ standard: "permit", unlimited: true, symbol: "hUSDC" });
    expect(check(r, "ui-match")).toMatchObject({ status: "fail" });
  }, 60_000);

  it("fixed: SIWE sign-in for the page host → consistent", async () => {
    const text = F.siweMessage("127.0.0.1:5173", USER, "http://127.0.0.1:5173").replace("Chain ID: 1", `Chain ID: ${CHAIN_ID}`);
    const r = await reviewer.review(input({ ...F.signRequest("personal_sign", [`0x${Buffer.from(text).toString("hex")}`, USER], CHAIN_ID), from: USER }, { pageUrl: "http://127.0.0.1:5173/", buttonLabel: "Sign in" }));
    log("fixed-siwe", r);
    expect(r.verdict).toBe("consistent");
    expect(r.title).toBe("Sign in to 127.0.0.1:5173");
  }, 60_000);

  it("a deposit without allowance reverts on the fork and the review says so", async () => {
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [F.usdc(100), USER] });
    const r = await reviewer.review(input(tx(contracts.HarborVault, data), { buttonLabel: "Deposit 100 hUSDC" }));
    log("deposit-reverts", r);
    expect(check(r, "simulation")).toMatchObject({ status: "warn" });
    expect(check(r, "simulation").detail).toMatch(/insufficient allowance/);
    expect(r.title).toBe("Deposit 100 hUSDC on HarborVault".replace("HarborVault", "0xe7f1…0512").replace("0xe7f1…0512", r.title.slice(r.title.lastIndexOf(" on ") + 4)));
    expect(r.verdict).toBe("check");
  }, 60_000);
});
