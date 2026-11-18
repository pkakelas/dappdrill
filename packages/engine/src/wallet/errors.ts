import { chainName, type WalletRequest } from "@dappdrill/core";
import { JsonRpcError } from "../chain/rpc.js";

/** How a line can tell our wallet couldn't pay from a failure of the app. */
export const NO_FUNDS = "has too little on";

/** Why our wallet couldn't pay for a request, when that is why it failed: the account holds too little on that chain. */
export function unpaid(r: WalletRequest, wallet: string): string | undefined {
  if (!/insufficient funds/i.test(r.error ?? "")) return undefined;
  return `The test wallet ${wallet} ${NO_FUNDS} ${chainName(r.chainId)} to pay for this transaction. Send it some, or give a key that funds the test accounts, and run again.`;
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
};
