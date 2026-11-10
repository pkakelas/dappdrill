import { chainName, type WalletRequest } from "@dappdrill/core";
import { JsonRpcError } from "../chain/rpc.js";

/** How a step can tell our wallet couldn't pay from an app failure. */
const NO_LIVE_KEY = "no funded test key";

/**
 * Why our wallet couldn't pay for a request, when that is why it failed: a live chain with no key, or a key
 * with too little on it. On a fork the wallet holds what the test gave it, so running short there is the test's subject.
 */
export function unpaid(r: WalletRequest, wallet: string, live: boolean): string | undefined {
  if (r.error?.includes(NO_LIVE_KEY)) return r.error.replace(/^\d+ /, "");
  if (live && /insufficient funds/i.test(r.error ?? "")) {
    return `The test wallet ${wallet} has too little on ${chainName(r.chainId)} to pay for this transaction. Send it some and run again.`;
  }
  return undefined;
}

/** EIP-1193 / MetaMask error codes with MetaMask's wording. */
export const WalletErrors = {
  userRejected: () => new JsonRpcError(4001, "User rejected the request."),
  unauthorized: () => new JsonRpcError(4100, "The requested account and/or method has not been authorized by the user."),
  unsupportedMethod: (method: string) => new JsonRpcError(4200, `The requested method "${method}" is not supported by this Ethereum provider.`),
  disconnected: () => new JsonRpcError(4900, "The provider is disconnected from all chains."),
  chainDisconnected: (chainId: number) => new JsonRpcError(4901, `The provider is disconnected from chain ${chainId}.`),
  unrecognizedChain: (hexChainId: string) =>
    new JsonRpcError(4902, `Unrecognized chain ID "${hexChainId}". Try adding the chain using wallet_addEthereumChain first.`),
  invalidParams: (detail: string) => new JsonRpcError(-32602, `Invalid parameters: ${detail}`),
  methodNotFound: (method: string) => new JsonRpcError(-32601, `The method "${method}" does not exist / is not available.`),
  internal: (detail: string, data?: unknown) => new JsonRpcError(-32603, "Internal JSON-RPC error.", data ?? { message: detail }),
  /** Live chain without a funded key: the throwaway wallet can't pay for transactions. */
  needsLiveKey: (chainName: string) =>
    new JsonRpcError(4100, `DappDrill has ${NO_LIVE_KEY} for ${chainName}; transactions are unavailable until a live key is added.`),
};
