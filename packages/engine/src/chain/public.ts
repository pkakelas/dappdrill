import { createPublicClient, http, type PublicClient } from "viem";
import { KNOWN_CHAINS, chainInfo } from "@dappdrill/core";

/**
 * Read-only clients for the well-known chains a run isn't using, over their public RPCs: where a
 * token on the far side of a bridge can be looked up. Like the chain a request was sent on, test or
 * real. What they say was never on a fork, so whoever reports it says so.
 */
export function publicClients(inUse: number[], like?: number): { chainId: number; client: PublicClient }[] {
  const testnet = like === undefined ? undefined : chainInfo(like)?.testnet;
  return KNOWN_CHAINS.filter((c) => !inUse.includes(c.id) && (testnet === undefined || c.testnet === testnet)).map((c) => ({
    chainId: c.id,
    client: createPublicClient({ transport: http(c.rpcUrl, { batch: true, timeout: 5_000, retryCount: 0 }) }),
  }));
}
