/**
 * Signatures an app uses on the real chain. On our copy the wallet signs a permit or an order, and
 * the app's server, which talks to the real chain, submits it there. The copy never sees that, so
 * from then on it is behind the real chain: the permit's nonce is used up there and not here, and
 * what the server reports doesn't match what the copy holds. After each signature we look on the
 * real chain for the signed contract logging our account.
 */
import { pad } from "viem";
import type { Hex } from "../types.js";
import { rpcCall, toHex } from "./rpc.js";

/** When to look after a signature: relayers usually submit within seconds, some batch for a minute or two. */
export const LOOK_AFTER_MS = [10_000, 30_000, 90_000];
/** Blocks before the real head at signing time to look from, in case our RPC is a little behind the relayer's. */
const MARGIN_BLOCKS = 20n;
const TIMEOUT_MS = 10_000;

export interface RelayWatch {
  chainId: number;
  /** The signed data's verifyingContract. */
  contract: Hex;
  account: Hex;
  /** The real chain's RPC that answered, and the block to look from; undefined when none answered. */
  from: Promise<{ rpcUrl: string; block: bigint } | undefined>;
}

/** Where to start looking: the real head when the signature was made, from the first RPC that answers. */
export async function startOfWatch(rpcUrls: string[]): Promise<{ rpcUrl: string; block: bigint } | undefined> {
  for (const rpcUrl of rpcUrls) {
    try {
      const head = BigInt((await rpcCall(rpcUrl, "eth_blockNumber", [], { timeoutMs: TIMEOUT_MS, retryDelaysMs: [] })) as string);
      return { rpcUrl, block: head > MARGIN_BLOCKS ? head - MARGIN_BLOCKS : 0n };
    } catch {
      // the next one
    }
  }
  return undefined;
}

/** Whether `contract` logged `account` in any indexed topic on the real chain from `fromBlock` on. */
export async function loggedSince(rpcUrl: string, contract: Hex, account: Hex, fromBlock: bigint): Promise<boolean> {
  const topic = pad(account.toLowerCase() as Hex);
  const filters = [[null, topic], [null, null, topic], [null, null, null, topic]];
  const found = await Promise.all(
    filters.map(async (topics) => {
      const logs = await rpcCall(rpcUrl, "eth_getLogs", [{ address: contract, fromBlock: toHex(fromBlock), toBlock: "latest", topics }], { timeoutMs: TIMEOUT_MS });
      return Array.isArray(logs) && logs.length > 0;
    }),
  );
  return found.some(Boolean);
}
