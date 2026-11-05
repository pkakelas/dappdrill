/**
 * Signing with viem local accounts. Transactions get nonce, gas and fees
 * filled from the chain the way MetaMask does, then go out as raw
 * transactions straight to the node: the wallet has its own RPC, so the
 * latency/failure faults aimed at the dApp never touch it.
 */
import {
  InvalidStructTypeError,
  concat,
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  isHex,
  keccak256,
  type Hex as ViemHex,
  type PrivateKeyAccount,
} from "viem";
import type { ChainController, Hex } from "../types.js";
import { JsonRpcError, hexToNumber, rpcCall, toHex } from "../chain/rpc.js";
import { WalletErrors } from "./errors.js";

export interface TxRequest {
  from?: string;
  to?: string;
  value?: string;
  data?: string;
  input?: string;
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
  chainId?: string;
  type?: string;
}

/** Everything we decided for a transaction, kept so speed-up can replace it. */
export interface PreparedTx {
  chainId: number;
  nonce: number;
  to?: Hex;
  value: bigint;
  data: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export async function signPersonal(account: PrivateKeyAccount, params: unknown): Promise<Hex> {
  const [message] = requireParams(params, 1, "personal_sign expects [message, address]");
  const raw = typeof message === "string" && isHex(message) ? ({ raw: message } as const) : String(message);
  return account.signMessage({ message: raw });
}

export async function signEthSign(account: PrivateKeyAccount, params: unknown): Promise<Hex> {
  const [, hash] = requireParams(params, 2, "eth_sign expects [address, data]");
  if (typeof hash !== "string" || !isHex(hash)) throw WalletErrors.invalidParams("eth_sign data must be hex");
  return account.sign({ hash: hash as ViemHex });
}

/** The chain typed data is bound to (its domain's chainId), when it names one. */
export function typedDataChainId(params: unknown[]): number | undefined {
  const payload = params[1];
  let typed: any;
  try {
    typed = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    return undefined;
  }
  const raw = typed?.domain?.chainId;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export async function signTypedData(account: PrivateKeyAccount, params: unknown, activeChainId?: number): Promise<Hex> {
  const [, payload] = requireParams(params, 2, "eth_signTypedData expects [address, typedData]");
  let typed: any;
  try {
    typed = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    throw WalletErrors.invalidParams("typed data must be a JSON string or object");
  }
  if (!typed || typeof typed !== "object" || !typed.types || !typed.primaryType) {
    throw WalletErrors.invalidParams("typed data needs types, primaryType, domain and message");
  }
  const { EIP712Domain: _domain, ...types } = typed.types;
  const domain = { ...typed.domain };
  // Dapps often send "1"; viem leaves a string chainId out of the domain, and the signature then fails on chain.
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  // MetaMask refuses typed data bound to another chain than the one it is on.
  if (activeChainId !== undefined && domain.chainId !== undefined && domain.chainId !== activeChainId) {
    throw WalletErrors.invalidParams(`Provided chainId "${domain.chainId}" must match the active chainId "${activeChainId}"`);
  }
  try {
    return await account.signTypedData({ domain, types, primaryType: typed.primaryType, message: typed.message });
  } catch (err) {
    if (!(err instanceof InvalidStructTypeError)) throw err;
    // viem only allows [A-Za-z0-9_$] in struct names; MetaMask also signs names like
    // "Hyperliquid:AcceptTerms". viem's hashing itself handles them, so hash unvalidated.
    const all = { EIP712Domain: typed.types.EIP712Domain ?? getTypesForEIP712Domain({ domain }), ...types };
    const hash = keccak256(concat(["0x1901", hashDomain({ domain, types: all }), hashStruct({ data: typed.message, primaryType: typed.primaryType, types: all })]));
    return account.sign({ hash });
  }
}

/** Fill in what the dApp left out, like MetaMask's confirmation screen does. */
export async function prepareTransaction(chains: ChainController, chainId: number, from: Hex, tx: TxRequest, opts: { feeBump?: bigint } = {}): Promise<PreparedTx> {
  if (tx.from && tx.from.toLowerCase() !== from.toLowerCase()) {
    throw WalletErrors.invalidParams(`from ${tx.from} is not the selected account`);
  }
  if (tx.chainId !== undefined && hexToNumber(tx.chainId) !== chainId) {
    throw WalletErrors.invalidParams(`transaction chainId ${tx.chainId} does not match the wallet's chain ${toHex(chainId)}`);
  }
  const data = (tx.data ?? tx.input ?? "0x") as Hex;
  const value = tx.value ? BigInt(tx.value) : 0n;
  const to = tx.to ? (tx.to as Hex) : undefined;
  const rpc = (m: string, p: unknown[]) => rpcCall(chains.rpcUrl(chainId), m, p);

  const nonce = tx.nonce !== undefined ? hexToNumber(tx.nonce) : hexToNumber(await rpc("eth_getTransactionCount", [from, "pending"]));

  let gas: bigint;
  if (tx.gas ?? tx.gasLimit) gas = BigInt((tx.gas ?? tx.gasLimit)!);
  else {
    const est = await rpc("eth_estimateGas", [{ from, to, value: toHex(value), data }]);
    gas = (BigInt(est as string) * 12n) / 10n;
  }

  let maxFeePerGas: bigint;
  let maxPriorityFeePerGas: bigint;
  if (tx.maxFeePerGas) {
    maxFeePerGas = BigInt(tx.maxFeePerGas);
    maxPriorityFeePerGas = tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : maxFeePerGas;
  } else if (tx.gasPrice) {
    maxFeePerGas = maxPriorityFeePerGas = BigInt(tx.gasPrice);
  } else {
    const block = (await rpc("eth_getBlockByNumber", ["latest", false])) as { baseFeePerGas?: string } | null;
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : BigInt((await rpc("eth_gasPrice", [])) as string);
    maxPriorityFeePerGas = 1_000_000_000n; // 1 gwei tip, MetaMask's "market" default on quiet chains
    maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
  }
  if (opts.feeBump) {
    maxFeePerGas = (maxFeePerGas * opts.feeBump) / 100n;
    maxPriorityFeePerGas = (maxPriorityFeePerGas * opts.feeBump) / 100n;
  }
  return { chainId, nonce, to, value, data, gas, maxFeePerGas, maxPriorityFeePerGas };
}

export async function sendPrepared(chains: ChainController, account: PrivateKeyAccount, tx: PreparedTx): Promise<Hex> {
  const raw = await account.signTransaction({
    chainId: tx.chainId,
    nonce: tx.nonce,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    gas: tx.gas,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    type: "eip1559",
  });
  try {
    return (await rpcCall(chains.rpcUrl(tx.chainId), "eth_sendRawTransaction", [raw])) as Hex;
  } catch (e) {
    throw nodeError(e);
  }
}

/**
 * MetaMask wraps node rejections as -32603 with the node's error in `data`.
 * Insufficient funds keeps the node's -32000 and message, as most wallets
 * pass it through, so apps (and viem) can tell the user to add ETH.
 */
export function nodeError(e: unknown): JsonRpcError {
  const message = e instanceof Error ? e.message : String(e);
  const nodeMessage = e instanceof JsonRpcError ? ((e.data as { message?: string } | undefined)?.message ?? message) : message;
  if (/insufficient funds/i.test(nodeMessage)) return new JsonRpcError(-32000, nodeMessage);
  if (e instanceof JsonRpcError && e.code === -32603) return e;
  if (e instanceof JsonRpcError) return new JsonRpcError(-32603, "Internal JSON-RPC error.", { code: e.code, message: e.message, data: e.data });
  return new JsonRpcError(-32603, "Internal JSON-RPC error.", { message: e instanceof Error ? e.message : String(e) });
}

function requireParams(params: unknown, n: number, hint: string): unknown[] {
  if (!Array.isArray(params) || params.length < n) throw WalletErrors.invalidParams(hint);
  return params;
}
