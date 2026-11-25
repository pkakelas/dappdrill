/** Sending back what a test left on its accounts, on a real Anvil. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, http, parseEther, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { startChains } from "../../src/chain/controller.js";
import { fundAccount, newAccounts } from "../../src/run/env.js";
import { sendBack } from "../../src/run/sweep.js";
import type { ChainController } from "../../src/types.js";
import { TOKEN_ABI } from "./contracts.js";
import { CHAIN_ID, DEPLOYER_KEY, startFixture, type Fixture } from "./fixture.js";

let fx: Fixture;
let chains: ChainController;
const deployer = privateKeyToAccount(DEPLOYER_KEY);
const addressOf = (key: string) => privateKeyToAccount(key as Hex).address;
const coin = (who: Hex) => chains.client(CHAIN_ID).getBalance({ address: who });
const tokens = (who: Hex) => chains.client(CHAIN_ID).readContract({ address: fx.token, abi: TOKEN_ABI, functionName: "balanceOf", args: [who] });
const known = () => [{ chainId: CHAIN_ID, token: fx.token, amount: "1", symbol: "TUSD" }];
/** What was said while sending back, warnings marked. */
function listener() {
  const said: string[] = [];
  return { said, say: (message: string, level?: "info" | "warn") => void said.push(level === "warn" ? `warn: ${message}` : message) };
}

/** A funding key of its own for each test, holding 10 of the chain's coin and so many test tokens. */
async function payer(holds: string): Promise<Hex> {
  const key = generatePrivateKey();
  const wallet = createWalletClient({ account: deployer, transport: http(fx.rpcUrl) });
  for (const hash of [
    await wallet.sendTransaction({ to: addressOf(key), value: parseEther("10"), chain: null }),
    await wallet.writeContract({ abi: TOKEN_ABI, address: fx.token, functionName: "mint", args: [addressOf(key), parseUnits(holds, 6)], chain: null }),
  ]) {
    await chains.client(CHAIN_ID).waitForTransactionReceipt({ hash, pollingInterval: 100 });
  }
  return key;
}

beforeAll(async () => {
  fx = await startFixture();
  chains = startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], {});
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

describe("sendBack", () => {
  it("returns the tokens and the chain's coin of both accounts to the key that paid, and says so once per account", async () => {
    const key = await payer("100");
    const accounts = newAccounts({ fundedKey: key, runId: "sweep-1" }, 1);
    await fundAccount(
      chains,
      {
        fundedKey: key,
        fund: [
          { chainId: CHAIN_ID, amount: "1" },
          { chainId: CHAIN_ID, token: fx.token, amount: "60" },
        ],
      },
      addressOf(accounts.A),
    );
    await fundAccount(chains, { fundedKey: key, fund: [{ chainId: CHAIN_ID, amount: "0.5" }] }, addressOf(accounts.B));
    const before = await coin(addressOf(key));

    const { said, say } = listener();
    await sendBack(chains, key, accounts, known(), say);

    expect(await tokens(addressOf(key))).toBe(parseUnits("100", 6));
    for (const who of [accounts.A, accounts.B]) {
      expect(await tokens(addressOf(who))).toBe(0n);
      expect((await coin(addressOf(who))) < parseEther("0.001")).toBe(true);
    }
    expect((await coin(addressOf(key))) - before > parseEther("1.49")).toBe(true);
    expect(said.sort()).toEqual([expect.stringMatching(/^Sent back 0\.49\d+ ETH on Local from the test account 0x/), expect.stringMatching(/^Sent back 60 TUSD and 0\.99\d+ ETH on Local from the test account 0x/)]);

    // A second pass finds only what a transfer would cost, and leaves it.
    const again = listener();
    await sendBack(chains, key, accounts, known(), again.say);
    expect(again.said).toEqual([]);
  }, 60_000);

  it("pays for the transfer itself when an account holds tokens and no coin", async () => {
    const key = await payer("100");
    const accounts = newAccounts({ fundedKey: key, runId: "sweep-2" }, 1);
    await fundAccount(chains, { fundedKey: key, fund: [{ chainId: CHAIN_ID, token: fx.token, amount: "40" }] }, addressOf(accounts.A));
    const before = await coin(addressOf(key));

    const { said, say } = listener();
    await sendBack(chains, key, accounts, known(), say);

    expect(await tokens(addressOf(key))).toBe(parseUnits("100", 6));
    expect(before - (await coin(addressOf(key))) < parseEther("0.001")).toBe(true);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Sent back 40 TUSD/);
  }, 60_000);

  it("leaves alone a token nobody named, an empty account and the funding key itself", async () => {
    const key = await payer("100");
    const accounts = newAccounts({ fundedKey: key, runId: "sweep-3" }, 1);
    await fundAccount(chains, { fundedKey: key, fund: [{ chainId: CHAIN_ID, token: fx.token, amount: "5" }] }, addressOf(accounts.A));
    const before = [await coin(addressOf(key)), await tokens(addressOf(key))];

    const { said, say } = listener();
    await sendBack(chains, key, accounts, [], say);
    // A kept account that is the funding key is never emptied into itself.
    await sendBack(chains, key, { A: key, B: accounts.B }, known(), say);

    expect(said).toEqual([]);
    expect(await tokens(addressOf(accounts.A))).toBe(parseUnits("5", 6));
    expect([await coin(addressOf(key)), await tokens(addressOf(key))]).toEqual(before);
  }, 60_000);

  it("says what it couldn't send back as a warning and never throws", async () => {
    const key = await payer("100");
    const accounts = newAccounts({ fundedKey: key, runId: "sweep-4" }, 1);
    await fundAccount(chains, { fundedKey: key, fund: [{ chainId: CHAIN_ID, amount: "0.2" }] }, addressOf(accounts.A));
    // Not a token: reading its balance fails.
    const notAToken = [{ chainId: CHAIN_ID, token: addressOf(generatePrivateKey()), amount: "1", symbol: "NOPE" }];

    const { said, say } = listener();
    await expect(sendBack(chains, key, accounts, notAToken, say)).resolves.toBeUndefined();
    expect(said.filter((s) => s.startsWith("warn: Couldn't send back what the test account 0x")).length).toBeGreaterThan(0);
    expect(said.every((s) => s.includes(" on Local"))).toBe(true);

    // A listener that breaks doesn't break the run either.
    await expect(
      sendBack(chains, key, accounts, notAToken, () => {
        throw new Error("the sink is gone");
      }),
    ).resolves.toBeUndefined();
  }, 60_000);
});
