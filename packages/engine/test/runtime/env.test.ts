import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, http, parseEther, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { ChainConfig } from "@dappdrill/core";
import { startChains } from "../../src/chain/controller.js";
import { accountsFor, fundAccount, newAccounts, withAccounts, withoutFallback, type Env } from "../../src/run/env.js";
import type { ChainController } from "../../src/types.js";
import { TOKEN_ABI } from "./contracts.js";
import { ACCOUNTS, CHAIN_ID, DEPLOYER_KEY, startFixture, type Fixture } from "./fixture.js";

const eth: ChainConfig = { id: 1, name: "Ethereum", rpcUrl: "https://eth.example", fallback: true };
const pod: ChainConfig = { id: 129302, rpcUrl: "https://rpc.pod.example", fromApp: true };

describe("withoutFallback", () => {
  it("drops the Ethereum fallback once the app's own chain is known", () => {
    expect(withoutFallback([eth, pod])).toEqual([pod]);
  });
  it("keeps it when it's the only chain", () => {
    expect(withoutFallback([eth])).toEqual([eth]);
    expect(withoutFallback([])).toEqual([]);
  });
});

describe("accountsFor", () => {
  const key = `0x${"1".repeat(64)}`;

  it("gives keys nobody has seen for new accounts, whatever was saved", () => {
    const a = accountsFor({ account: "new", accounts: ACCOUNTS, fundedKey: key });
    const b = accountsFor({ account: "new", accounts: ACCOUNTS, fundedKey: key });
    expect(a.A).toMatch(/^0x[0-9a-f]{64}$/);
    expect([ACCOUNTS.A, key, b.A, a.B]).not.toContain(a.A);
  });

  it("keeps the saved accounts on a kept account, with the funded key as account A when there is one", () => {
    expect(accountsFor({ account: "kept", accounts: ACCOUNTS })).toEqual(ACCOUNTS);
    expect(accountsFor({ account: "kept", accounts: ACCOUNTS, fundedKey: key })).toEqual({ A: key, B: ACCOUNTS.B });
    expect(accountsFor({ account: "kept", fundedKey: key }).A).toBe(key);
  });
});

describe("newAccounts", () => {
  const seed = { fundedKey: `0x${"1".repeat(64)}`, runId: "a1b2c3" };

  it("makes the same keys again from the funding key, the run's id and the start's number", () => {
    const first = newAccounts(seed, 1);
    expect(newAccounts({ ...seed }, 1)).toEqual(first);
    expect(first.A).toMatch(/^0x[0-9a-f]{64}$/);
    const others = [first.B, newAccounts(seed, 2).A, newAccounts({ ...seed, runId: "a1b2c4" }, 1).A, newAccounts({ ...seed, fundedKey: `0x${"2".repeat(64)}` }, 1).A, seed.fundedKey];
    expect(new Set([first.A, ...others]).size).toBe(6);
  });

  it("makes keys nobody can make again when no key pays them", () => {
    expect(newAccounts().A).not.toBe(newAccounts().A);
  });
});

describe("withAccounts", () => {
  it("shares everything but the accounts, and closing it leaves the env open", async () => {
    let closed = 0;
    const env = { target: { url: "http://app.example", accounts: ACCOUNTS }, chains: {}, costUsd: () => 3, close: async () => void closed++ } as unknown as Env;
    const own = { A: generatePrivateKey(), B: generatePrivateKey() };
    const child = withAccounts(env, own);
    expect(child.target).toEqual({ url: "http://app.example", accounts: own });
    expect(env.target.accounts).toEqual(ACCOUNTS);
    expect(child.chains).toBe(env.chains);
    expect(child.costUsd()).toBe(3);
    await child.close();
    expect(closed).toBe(0);
  });
});

describe("fundAccount", () => {
  let fx: Fixture;
  let chains: ChainController;
  const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
  const coin = (who: `0x${string}`) => chains.client(CHAIN_ID).getBalance({ address: who });
  const tokens = (who: `0x${string}`) => chains.client(CHAIN_ID).readContract({ address: fx.token, abi: TOKEN_ABI, functionName: "balanceOf", args: [who] });

  beforeAll(async () => {
    fx = await startFixture();
    chains = startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], {});
    // The funding key holds the chain's coin from Anvil; its tokens come from the test token's open mint.
    const deployer = privateKeyToAccount(DEPLOYER_KEY);
    const wallet = createWalletClient({ account: deployer, transport: http(fx.rpcUrl) });
    const hash = await wallet.writeContract({ abi: TOKEN_ABI, address: fx.token, functionName: "mint", args: [deployer.address, parseUnits("5000", 6)], chain: null });
    await chains.client(CHAIN_ID).waitForTransactionReceipt({ hash, pollingInterval: 100 });
  }, 60_000);

  afterAll(async () => {
    await chains?.close();
    await fx?.close();
  });

  it("sends a new account the chain's coin and an ERC-20, in whole units", async () => {
    const to = fresh();
    await fundAccount(chains, { fundedKey: DEPLOYER_KEY, fund: [{ chainId: CHAIN_ID, amount: "0.5" }, { chainId: CHAIN_ID, token: fx.token, amount: "250" }] }, to);
    expect(await coin(to)).toBe(parseEther("0.5"));
    expect(await tokens(to)).toBe(parseUnits("250", 6));
  }, 30_000);

  it("pays accounts asked for at once one after another, so no payment is lost", async () => {
    const accounts = [fresh(), fresh(), fresh()];
    const fund = [{ chainId: CHAIN_ID, amount: "0.1" }, { chainId: CHAIN_ID, token: fx.token, amount: "10" }];
    await Promise.all(accounts.map((to) => fundAccount(chains, { fundedKey: DEPLOYER_KEY, fund }, to)));
    for (const to of accounts) {
      expect(await coin(to)).toBe(parseEther("0.1"));
      expect(await tokens(to)).toBe(parseUnits("10", 6));
    }
  }, 60_000);

  it("leaves the account empty with no key or nothing listed", async () => {
    const to = fresh();
    await fundAccount(chains, { fund: [{ chainId: CHAIN_ID, amount: "1" }] }, to);
    await fundAccount(chains, { fundedKey: DEPLOYER_KEY, fund: [] }, to);
    expect(await coin(to)).toBe(0n);
  });

  it("says which payment couldn't be made, and why", async () => {
    const to = fresh();
    await expect(fundAccount(chains, { fundedKey: DEPLOYER_KEY, fund: [{ chainId: CHAIN_ID, token: fx.token, amount: "999999", symbol: "TUSD" }] }, to)).rejects.toThrow(
      new RegExp(`^The key that funds the test accounts \\(.*\\) couldn't send 999999 TUSD on Local: .*insufficient balance`),
    );
    await expect(fundAccount(chains, { fundedKey: DEPLOYER_KEY, fund: [{ chainId: 4242, amount: "1" }] }, to)).rejects.toThrow("couldn't send 1 of the chain's coin on Chain 4242: that chain isn't one of the app's chains");
    // A key with nothing on it can't pay either.
    await expect(fundAccount(chains, { fundedKey: generatePrivateKey(), fund: [{ chainId: CHAIN_ID, amount: "1" }] }, to)).rejects.toThrow(/couldn't send 1 ETH on Local: /);
    expect(await coin(to)).toBe(0n);
    // The next payment from the same key still goes through.
    await fundAccount(chains, { fundedKey: DEPLOYER_KEY, fund: [{ chainId: CHAIN_ID, amount: "0.2" }] }, to);
    expect(await coin(to)).toBe(parseEther("0.2"));
  }, 60_000);
});
