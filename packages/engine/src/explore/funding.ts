/**
 * Tokens for the test wallet. A new wallet on a fork holds only the native coin, so an app whose
 * first move is "deposit USDC" gives nothing to test but its empty states. The look decides what
 * a user would bring, picking from the tokens the app asked the wallet's balance of, and every
 * fork after that starts with them (DrillTarget.tokens).
 */
import { erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import { z } from "zod";
import { chainInfo, type DrillTarget } from "@dappdrill/core";
import type { AgentTool, ChainController, DrillSession, Hex } from "../types.js";

export type WalletToken = DrillTarget["tokens"][number];

const MAX_TOKENS = 4;
const DEFAULT_AMOUNT = "1000";

interface TokenInfo {
  chainId: number;
  address: Hex;
  symbol: string;
  decimals: number;
  held: bigint;
}

export function fundTool(session: DrillSession, onFunded: (token: WalletToken, line: string) => void): AgentTool {
  const { chains, wallet } = session;
  const forks = () => chains.configs().filter((c) => chains.mode(c.id) === "fork").map((c) => c.id);
  const chainName = (id: number) => chainInfo(id)?.name ?? `chain ${id}`;
  const line = (t: TokenInfo) => `${t.symbol} ${t.address} on ${chainName(t.chainId)} (the wallet holds ${formatUnits(t.held, t.decimals)})`;
  const seen = async (): Promise<TokenInfo[]> => {
    const all = forks().flatMap((id) => (chains.tokensRead?.(id, wallet.address()) ?? []).map((address) => tokenInfo(chains, id, address, wallet.address())));
    return (await Promise.all(all)).filter((t) => t !== undefined);
  };
  let funded = 0;

  return {
    name: "fund_wallet",
    description:
      "Put an ERC-20 token in the test wallet on the forked chain, so tests can do the real thing (USDC to deposit, a token to swap). Call it without a token to list the tokens the app asked the wallet's balance of. Fund what a user brings to the app, never what the app gives out (vault shares, LP or receipt tokens, points, rewards). Every test then starts with this balance. Reload the page afterwards to see it.",
    schema: z.object({
      token: z.string().optional().describe("A symbol from the list, or the token's address"),
      amount: z.string().regex(/^\d+(\.\d+)?$/).optional().describe(`Whole tokens, default ${DEFAULT_AMOUNT}`),
    }),
    handler: async ({ token, amount = DEFAULT_AMOUNT }) => {
      if (!forks().length) return "The app's chain runs live, not as a fork, so the wallet can't be given tokens. Write tests for what the wallet holds.";
      const tokens = await seen();
      const list = tokens.length ? `The app asked the wallet's balance of:\n${tokens.map((t) => `- ${line(t)}`).join("\n")}` : "The app hasn't asked the chain for any token balance of the wallet yet. Open the page that shows balances first, or pass the token's address.";
      if (!token) return list;
      if (funded >= MAX_TOKENS) return `The wallet already got ${MAX_TOKENS} tokens, which is the most it gets.`;

      const want = token.trim().toLowerCase();
      const picked = isAddress(want)
        ? (tokens.find((t) => t.address === want) ?? (await Promise.all(forks().map((id) => tokenInfo(chains, id, want as Hex, wallet.address())))).find((t) => t !== undefined))
        : tokens.find((t) => t.symbol.toLowerCase() === want);
      if (!picked) return `No token "${token}" to fund. ${list}`;

      try {
        const units = parseUnits(amount, picked.decimals);
        for (const account of Object.values(wallet.accounts)) await chains.dealErc20(picked.chainId, picked.address, account, units);
      } catch (e) {
        return `Couldn't give the wallet ${picked.symbol}: ${e instanceof Error ? e.message.split("\n")[0] : e}. Write tests for what the wallet holds.`;
      }
      funded++;
      const done = `The test wallet starts with ${amount} ${picked.symbol} on ${chainName(picked.chainId)}`;
      onFunded({ chainId: picked.chainId, address: picked.address, amount, symbol: picked.symbol }, done);
      return `${done}. Reload the page to see it, then write tests that use it.`;
    },
  };
}

async function tokenInfo(chains: ChainController, chainId: number, address: Hex, holder: Hex): Promise<TokenInfo | undefined> {
  const client = chains.client(chainId);
  try {
    const [decimals, held] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    ]);
    // Some old tokens answer symbol() with bytes32; the address still names them.
    const symbol = await client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => `${address.slice(0, 8)}…`);
    return { chainId, address, symbol, decimals, held };
  } catch {
    return undefined;
  }
}

/** One token per chain and address; a later amount replaces an earlier one. */
export function withToken(tokens: WalletToken[], token: WalletToken): WalletToken[] {
  const same = (t: WalletToken) => t.chainId === token.chainId && t.address.toLowerCase() === token.address.toLowerCase();
  return [...tokens.filter((t) => !same(t)), token];
}
