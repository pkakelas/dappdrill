/**
 * Whether the funded wallet can pay for a run on a live chain. A fork funds itself; a live
 * chain spends real coin, and a run that stops at the first transaction for want of gas
 * says nothing about the app.
 */
import { privateKeyToAccount } from "viem/accounts";
import { chainInfo, formatUnitsPlain, shortAddress, type ChainConfig } from "@dappdrill/core";
import type { ChainController, Hex } from "../types.js";

/** Gas a transaction may take, and how many a run with its setup is allowed before the wallet is called short. */
const GAS_PER_TX = 300_000n;
const TXS_PER_RUN = 5n;

export interface Shortfall {
  chain: ChainConfig;
  address: string;
  holds: bigint;
  needs: bigint;
}

/** What a run should have in hand at this gas price. */
export function fundsNeeded(gasPrice: bigint): bigint {
  return gasPrice * GAS_PER_TX * TXS_PER_RUN;
}

/** The first live chain where the funded wallet holds less than a run needs, or undefined when it can pay everywhere. */
export async function liveShortfall(chains: ChainController, liveKey: string | undefined): Promise<Shortfall | undefined> {
  if (!liveKey) return undefined;
  const address = privateKeyToAccount(liveKey as Hex).address;
  for (const chain of chains.configs().filter((c) => c.mode === "live")) {
    try {
      const client = chains.client(chain.id);
      const [holds, gasPrice] = await Promise.all([client.getBalance({ address }), client.getGasPrice()]);
      const needs = fundsNeeded(gasPrice);
      if (holds < needs) return { chain, address, holds, needs };
    } catch {
      // A chain that won't answer is reported by the run itself.
    }
  }
  return undefined;
}

export function shortfallLine({ chain, address, holds, needs }: Shortfall): string {
  const symbol = chainInfo(chain.id)?.nativeSymbol ?? "of the native coin";
  const name = chain.name ?? `chain ${chain.id}`;
  return `The funded wallet ${shortAddress(address)} holds ${formatUnitsPlain(holds, 18, 6)} ${symbol} on ${name}; about ${formatUnitsPlain(needs, 18, 6)} ${symbol} is needed for a run. Add funds to it.`;
}
