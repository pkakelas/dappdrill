import type { ChainController } from "../types.js";

/**
 * A simulation borrows a fork: it takes a snapshot, sends as the user and reverts. A transaction
 * the wallet sends for real while one runs would be wiped by that revert, and its nonce read
 * mid-simulation would be wrong. So simulations and the wallet's sends take turns per chain, and a
 * simulation that timed out keeps its turn until it has reverted.
 */
const turns = new WeakMap<ChainController, Map<number, Promise<void>>>();

export function onChainInTurn<T>(chains: ChainController, chainId: number, work: () => Promise<T>): Promise<T> {
  let byChain = turns.get(chains);
  if (!byChain) turns.set(chains, (byChain = new Map()));
  const result = (byChain.get(chainId) ?? Promise.resolve()).then(work);
  const done = result.then(
    () => {},
    () => {},
  );
  byChain.set(chainId, done);
  void done.then(() => {
    if (byChain.get(chainId) === done) byChain.delete(chainId);
  });
  return result;
}
