import { JsonRpcError } from "../chain/rpc.js";

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
  /** Live chain without a funded key: we can't sign anything there. */
  needsLiveKey: (chainName: string) =>
    new JsonRpcError(4100, `DappDrill has no funded test key for ${chainName}; signing is unavailable until a live key is added.`),
};
