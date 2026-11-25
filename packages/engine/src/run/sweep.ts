/**
 * Sending back what a test left on its new accounts to the key that paid them, so a suite can run every
 * day on the same funds: the ERC-20s we know of, then the chain's coin less what the transfer costs.
 * Nothing here decides how a test went. What couldn't be sent back is said as a warning and stays on the
 * account, where the funding key can still collect it.
 */
import { encodeFunctionData, erc20Abi, formatEther, formatUnits } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainInfo, chainName, shortAddress, type Fund } from "@dappdrill/core";
import { prepareTransaction, sendPrepared } from "../wallet/signer.js";
import type { ChainController, Hex } from "../types.js";
import { fundAccount, type Accounts } from "./env.js";

/** How long a transfer back gets to be mined. */
const MINED_WITHIN_MS = 60_000;

export type Say = (message: string, level?: "info" | "warn") => void | Promise<void>;

/**
 * Empties accounts A and B on every chain of the run. `known` lists what accounts were paid: the tokens
 * in it are the ERC-20s looked for. Never throws.
 */
export async function sendBack(chains: ChainController, fundedKey: string, accounts: Accounts, known: Fund[], listener: Say): Promise<void> {
  const home = privateKeyToAccount(fundedKey as Hex).address;
  // A listener that breaks doesn't break the run.
  const say: Say = async (message, level) => {
    try {
      await listener(message, level);
    } catch {}
  };
  const jobs = [accounts.A, accounts.B].flatMap((key) => {
    const from = privateKeyToAccount(key as Hex);
    // The Ethereum fallback is nobody's chain: nothing was paid there.
    return chains.configs().flatMap((chain) => (chain.fallback || from.address === home ? [] : [{ from, chainId: chain.id }]));
  });
  await Promise.all(
    jobs.map(async ({ from, chainId }) => {
      try {
        const sent = await emptyOn(chains, from, fundedKey, chainId, tokensOn(known, chainId));
        if (sent.length) await say(`Sent back ${sent.join(" and ")} on ${chainName(chainId)} from the test account ${shortAddress(from.address)}`);
      } catch (e) {
        const said = e as { data?: { message?: string }; shortMessage?: string };
        const why = (said.data?.message ?? said.shortMessage ?? (e instanceof Error ? e.message : String(e))).split("\n")[0]!.slice(0, 200);
        await say(`Couldn't send back what the test account ${shortAddress(from.address)} holds on ${chainName(chainId)}: ${why}`, "warn");
      }
    }),
  );
}

/** The ERC-20s paid on a chain, each once. */
function tokensOn(known: Fund[], chainId: number): { token: Hex; symbol?: string }[] {
  const seen = new Map<string, { token: Hex; symbol?: string }>();
  for (const f of known) if (f.chainId === chainId && f.token && !seen.has(f.token.toLowerCase())) seen.set(f.token.toLowerCase(), { token: f.token as Hex, symbol: f.symbol });
  return [...seen.values()];
}

/** One account on one chain: tokens first, while there is coin to pay for them. Returns what was sent, in words. */
async function emptyOn(chains: ChainController, from: PrivateKeyAccount, fundedKey: string, chainId: number, tokens: { token: Hex; symbol?: string }[]): Promise<string[]> {
  const home = privateKeyToAccount(fundedKey as Hex).address;
  const client = chains.client(chainId);
  const mined = async (hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: MINED_WITHIN_MS, pollingInterval: 1_000 });
    if (receipt.status !== "success") throw new Error("the transaction reverted");
  };
  const sent: string[] = [];

  for (const { token, symbol } of tokens) {
    const held = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [from.address] });
    if (held === 0n) continue;
    const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [home, held] });
    const tx = await prepareTransaction(chains, chainId, from.address, { to: token, data });
    // An account that holds tokens and no coin can't pay to send them: the key they go back to pays for that too.
    const cost = tx.gas * tx.maxFeePerGas;
    if ((await client.getBalance({ address: from.address })) < cost) await fundAccount(chains, { fundedKey, fund: [{ chainId, amount: formatEther(cost * 2n) }] }, from.address);
    await mined(await sendPrepared(chains, from, tx));
    sent.push(`${formatUnits(held, decimals)} ${symbol ?? `of the token ${shortAddress(token)}`}`);
  }

  const balance = await client.getBalance({ address: from.address });
  if (balance === 0n) return sent;
  const tx = await prepareTransaction(chains, chainId, from.address, { to: home, value: "0x0" });
  // The most the transfer can cost, and half as much again for what a rollup charges on top for its data.
  const reserve = (tx.gas * tx.maxFeePerGas * 3n) / 2n;
  // Not worth a transfer that costs as much as it carries.
  if (balance < reserve * 2n) return sent;
  await mined(await sendPrepared(chains, from, { ...tx, value: balance - reserve }));
  sent.push(`${formatEther(balance - reserve)} ${chainInfo(chainId)?.nativeSymbol ?? "of the chain's coin"}`);
  return sent;
}
