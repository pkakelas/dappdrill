/**
 * Normalises the raw params of a wallet request into one of three shapes:
 * a transaction (or a batch of calls), a message to sign, or EIP-712 typed data.
 */
import { getAddress, hexToBigInt, hexToString, isAddress, isHex, type Address, type Hex } from "viem";
import type { WalletRequest } from "@dappdrill/core";

export interface Call {
  to?: Address;
  data: Hex;
  value: bigint;
}

export interface TypedData {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

export type ParsedRequest =
  | { kind: "transaction"; from?: Address; calls: Call[] }
  | { kind: "message"; from?: Address; raw: string; text?: string; isHash: boolean }
  | { kind: "typedData"; from?: Address; typedData: TypedData }
  | { kind: "unknown"; from?: Address; reason: string };

const TX_METHODS = new Set(["eth_sendTransaction", "eth_signTransaction"]);
const TYPED_METHODS = new Set(["eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4"]);

export function parseRequest(req: WalletRequest): ParsedRequest {
  try {
    const params = Array.isArray(req.params) ? req.params : [req.params];
    const from = addr(req.from);
    if (TX_METHODS.has(req.method)) return parseTransaction(params, from);
    if (req.method === "wallet_sendCalls") return parseSendCalls(params, from);
    if (req.method === "personal_sign" || req.method === "eth_sign") return parseMessage(req.method, params, from);
    if (TYPED_METHODS.has(req.method)) return parseTypedData(params, from);
    return { kind: "unknown", from, reason: `Unsupported method ${req.method}` };
  } catch (e) {
    return { kind: "unknown", from: addr(req.from), reason: `Could not parse params: ${(e as Error).message}` };
  }
}

function parseTransaction(params: unknown[], from?: Address): ParsedRequest {
  const tx = (params[0] ?? {}) as Record<string, unknown>;
  return { kind: "transaction", from: addr(tx.from) ?? from, calls: [toCall(tx)] };
}

/** EIP-5792 wallet_sendCalls: { from, chainId, calls: [{ to, data, value }] }. */
function parseSendCalls(params: unknown[], from?: Address): ParsedRequest {
  const batch = (params[0] ?? {}) as Record<string, unknown>;
  const calls = Array.isArray(batch.calls) ? (batch.calls as Record<string, unknown>[]).map(toCall) : [];
  return { kind: "transaction", from: addr(batch.from) ?? from, calls };
}

function toCall(tx: Record<string, unknown>): Call {
  const data = typeof tx.data === "string" && isHex(tx.data) ? tx.data : typeof tx.input === "string" && isHex(tx.input) ? tx.input : "0x";
  return { to: addr(tx.to), data, value: toBigInt(tx.value) };
}

function parseMessage(method: string, params: unknown[], from?: Address): ParsedRequest {
  // personal_sign is [message, address]; eth_sign is [address, hash]. Some dApps swap them, so pick by shape.
  const strings = params.filter((p): p is string => typeof p === "string");
  const address = strings.find((s) => isAddress(s));
  const raw = strings.find((s) => s !== address) ?? "";
  const signer = addr(address) ?? from;
  if (!isHex(raw)) return { kind: "message", from: signer, raw, text: raw, isHash: false };
  const isHash = method === "eth_sign" || raw.length === 66;
  const text = utf8(raw);
  return { kind: "message", from: signer, raw, text, isHash: isHash && text === undefined };
}

function parseTypedData(params: unknown[], from?: Address): ParsedRequest {
  const address = params.find((p): p is string => typeof p === "string" && isAddress(p));
  const signer = addr(address) ?? from;
  const payload = params.find((p) => p !== address && p !== undefined);
  const parsed = typeof payload === "string" ? (JSON.parse(payload) as unknown) : payload;
  if (Array.isArray(parsed)) {
    // Legacy eth_signTypedData (v1): [{ type, name, value }]. Present it as a flat message.
    const message: Record<string, unknown> = {};
    const fields: { name: string; type: string }[] = [];
    for (const f of parsed as { type: string; name: string; value: unknown }[]) {
      message[f.name] = f.value;
      fields.push({ name: f.name, type: f.type });
    }
    return { kind: "typedData", from: signer, typedData: { types: { Message: fields }, primaryType: "Message", domain: {}, message } };
  }
  const td = parsed as Partial<TypedData>;
  if (!td || typeof td !== "object" || !td.types || !td.primaryType || !td.message) {
    return { kind: "unknown", from: signer, reason: "Typed data is missing types, primaryType or message" };
  }
  return { kind: "typedData", from: signer, typedData: { types: td.types, primaryType: td.primaryType, domain: td.domain ?? {}, message: td.message } };
}

export function addr(v: unknown): Address | undefined {
  return typeof v === "string" && isAddress(v) ? getAddress(v) : undefined;
}

export function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") {
    if (isHex(v)) return v === "0x" ? 0n : hexToBigInt(v);
    if (/^\d+$/.test(v)) return BigInt(v);
  }
  return 0n;
}

/** Decode hex as UTF-8 when it is printable text; undefined for binary blobs. */
export function utf8(hex: Hex): string | undefined {
  try {
    const s = hexToString(hex);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/.test(s)) return undefined;
    return s;
  } catch {
    return undefined;
  }
}
