/**
 * Transaction calldata → function + arguments, with nested calls expanded
 * (multicall, Multicall3 aggregate*, Universal Router execute, EIP-5792
 * batches). ABI order: ERC-7730 descriptor → verified source (Sourcify /
 * explorer, through proxies) → built-in ABIs → signature database.
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbiItem,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import type { DecodedArg, DecodedRequest } from "@dappdrill/core";
import { signatureDb } from "./abi-sources.js";
import { BUILTIN_ABI, UNIVERSAL_ROUTER_COMMANDS } from "./builtin.js";
import type { Contracts, TokenInfo } from "./contract.js";
import { erc7730Calldata, type Erc7730Match } from "./erc7730.js";
import { displayAddress, displayAmount, stringify } from "./format.js";
import { withTimeout, type Http } from "./http.js";
import type { Call } from "./request.js";

export interface DecodedCall {
  to?: Address;
  value: bigint;
  data: Hex;
  selector?: Hex;
  functionName?: string;
  /** "approve(address,uint256)" */
  signature?: string;
  args: DecodedArg[];
  /** Decoded values in ABI order (bigints, addresses, tuples). */
  raw: readonly unknown[];
  abiSource: NonNullable<DecodedRequest["abiSource"]>;
  contractName?: string;
  erc7730?: Erc7730Match;
  /** Calls this one makes on the user's behalf (multicall, aggregate, router commands). */
  inner: DecodedCall[];
}

export interface DecodeDeps {
  http: Http;
  chainId: number;
  contracts: Contracts;
  lookupTimeoutMs?: number;
}

const MAX_DEPTH = 3;
const PERMIT_SINGLE_PARAMS = parseAbiItem(
  "function f(((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit, bytes signature)",
).inputs;
const PERMIT_BATCH_PARAMS = parseAbiItem(
  "function f(((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permit, bytes signature)",
).inputs;
const TRANSFER_PARAMS = parseAbiItem("function f(address token, address recipient, uint256 value)").inputs;

export async function decodeCall(call: Call, deps: DecodeDeps, depth = 0): Promise<DecodedCall> {
  const base: DecodedCall = { to: call.to, value: call.value, data: call.data, args: [], raw: [], abiSource: "none", inner: [] };
  if (!call.to) return { ...base, functionName: "create", signature: "contract creation" };
  if (call.data.length < 10) return base; // plain value transfer
  const selector = call.data.slice(0, 10).toLowerCase() as Hex;
  const timeout = deps.lookupTimeoutMs ?? 10_000;

  const [info, erc7730] = await Promise.all([
    deps.contracts.info(call.to),
    withTimeout(erc7730Calldata(deps.http, deps.chainId, call.to, selector).catch(() => undefined), timeout, undefined),
  ]);
  const out: DecodedCall = { ...base, selector, contractName: info.name, erc7730 };

  const candidates: { abi: Abi; source: DecodedCall["abiSource"] }[] = [];
  if (erc7730?.abi) candidates.push({ abi: erc7730.abi, source: "erc7730" });
  if (info.abi && info.abiSource) candidates.push({ abi: info.abi, source: info.abiSource });
  candidates.push({ abi: BUILTIN_ABI, source: "builtin" });

  let decoded = tryDecode(candidates, call.data, selector);
  if (!decoded) {
    const sigs = await withTimeout(signatureDb(deps.http, selector).catch(() => undefined), timeout, undefined);
    for (const sig of sigs ?? []) {
      // The database already matched the selector; decode straight against the signature.
      try {
        const item = parseAbiItem(`function ${sig}`) as AbiFunction;
        const args = decodeAbiParameters(item.inputs, `0x${call.data.slice(10)}`);
        decoded = { item, args: args as readonly unknown[], source: "signature-db" as const };
        break;
      } catch {
        decoded = undefined;
      }
    }
  }
  if (!decoded) return out;

  const token = isTokenFunction(decoded.item.name) ? await deps.contracts.token(call.to) : undefined;
  // ERC-4626 deposit/withdraw take `assets` in the vault's underlying token, not in shares.
  const assets = token && decoded.item.inputs.some((i) => i.name === "assets") ? await deps.contracts.underlying(call.to) : undefined;
  out.functionName = decoded.item.name;
  out.signature = signatureOf(decoded.item);
  out.raw = decoded.args;
  out.abiSource = decoded.source;
  out.args = await describeArgs(decoded.item, decoded.args, token, deps, assets);
  if (depth < MAX_DEPTH) out.inner = await decodeInner(out, decoded.item, deps, depth + 1);
  return out;
}

function tryDecode(candidates: { abi: Abi; source: DecodedCall["abiSource"] }[], data: Hex, selector: Hex) {
  for (const { abi, source } of candidates) {
    const item = abi.find((i): i is AbiFunction => i.type === "function" && safeSelector(i) === selector);
    if (!item) continue;
    try {
      const { args } = decodeFunctionData({ abi: [item], data });
      return { item, args: (args ?? []) as readonly unknown[], source };
    } catch {
      // Try the next ABI: same selector, different argument layout.
    }
  }
  return undefined;
}

function safeSelector(item: AbiFunction): string | undefined {
  try {
    return toFunctionSelector(item).toLowerCase();
  } catch {
    return undefined;
  }
}

function signatureOf(item: AbiFunction): string {
  const typeOf = (p: { type: string; components?: readonly { type: string; components?: readonly unknown[] }[] }): string =>
    p.type.startsWith("tuple") ? `(${(p.components ?? []).map((c) => typeOf(c as typeof p)).join(",")})${p.type.slice(5)}` : p.type;
  return `${item.name}(${item.inputs.map((i) => typeOf(i)).join(",")})`;
}

const TOKEN_FUNCTIONS = new Set(["approve", "transfer", "transferFrom", "increaseAllowance", "decreaseAllowance", "permit", "withdraw", "deposit", "mint", "redeem", "safeTransferFrom", "transferWithAuthorization"]);
const AMOUNT_ARGS = new Set(["amount", "value", "wad", "addedValue", "subtractedValue", "assets", "shares", "requestedAmount", "amountIn", "amountOut", "amountInMax", "amountOutMin", "amountOutMinimum", "amountInMaximum"]);

function isTokenFunction(name: string): boolean {
  return TOKEN_FUNCTIONS.has(name);
}

async function describeArgs(item: AbiFunction, values: readonly unknown[], token: TokenInfo | undefined, deps: DecodeDeps, assets?: TokenInfo): Promise<DecodedArg[]> {
  const out: DecodedArg[] = [];
  for (const [i, input] of item.inputs.entries()) {
    const value = values[i];
    const name = input.name || `arg${i}`;
    const arg: DecodedArg = { name, type: input.type, value: stringify(value) };
    if (input.type === "address" && typeof value === "string") {
      const info = await deps.contracts.info(value as Address);
      arg.display = displayAddress(value, info.name ?? (info.code === "eoa" ? "wallet address" : undefined));
    } else if (input.type.startsWith("uint") && typeof value === "bigint" && AMOUNT_ARGS.has(name)) {
      const permit2 = item.name === "approve" && input.type === "uint160";
      // Permit2.approve(token, spender, amount, expiration): the token is the first argument.
      const t = permit2 && typeof values[0] === "string" ? await deps.contracts.token(values[0] as Address) : name === "assets" && assets ? assets : token;
      arg.display = displayAmount(value, t, { permit2, totalSupply: t?.totalSupply });
    } else if (input.type === "bytes" && typeof value === "string" && value.length > 74) {
      arg.display = `${value.slice(0, 42)}… (${(value.length - 2) / 2} bytes)`;
    }
    out.push(arg);
  }
  return out;
}

// ---------------------------------------------------------------- nested calls

async function decodeInner(call: DecodedCall, item: AbiFunction, deps: DecodeDeps, depth: number): Promise<DecodedCall[]> {
  const name = item.name;
  const raw = call.raw;
  const to = call.to!;
  try {
    if (name === "multicall") {
      const datas = (raw.find((v) => Array.isArray(v)) ?? []) as Hex[];
      return decodeMany(datas.map((data) => ({ to, data, value: 0n })), deps, depth);
    }
    if (name === "aggregate" || name === "tryAggregate" || name === "aggregate3" || name === "aggregate3Value") {
      const tuples = (raw.find((v) => Array.isArray(v)) ?? []) as { target: Address; callData: Hex; value?: bigint }[];
      return decodeMany(tuples.map((t) => ({ to: t.target, data: t.callData, value: t.value ?? 0n })), deps, depth);
    }
    if (name === "execute" && typeof raw[0] === "string" && Array.isArray(raw[1])) {
      return universalRouter(raw[0] as Hex, raw[1] as Hex[], deps);
    }
  } catch {
    // Nested decoding is best effort.
  }
  return [];
}

function decodeMany(calls: Call[], deps: DecodeDeps, depth: number): Promise<DecodedCall[]> {
  return Promise.all(calls.slice(0, 20).map((c) => decodeCall(c, deps, depth)));
}

/** Universal Router commands: list them, and decode the ones that grant or move tokens. */
async function universalRouter(commands: Hex, inputs: Hex[], deps: DecodeDeps): Promise<DecodedCall[]> {
  const out: DecodedCall[] = [];
  const bytes = commands.slice(2).match(/.{2}/g) ?? [];
  for (const [i, byte] of bytes.entries()) {
    const code = parseInt(byte, 16) & 0x3f;
    const name = UNIVERSAL_ROUTER_COMMANDS[code] ?? `COMMAND_0x${byte}`;
    const input = inputs[i] ?? "0x";
    const call: DecodedCall = { value: 0n, data: input, functionName: name, signature: `UniversalRouter.${name}`, args: [], raw: [], abiSource: "builtin", inner: [] };
    try {
      if (name === "PERMIT2_PERMIT") {
        const [permit] = decodeAbiParameters(PERMIT_SINGLE_PARAMS, input);
        const token = await deps.contracts.token(permit.details.token);
        const spender = await deps.contracts.info(permit.spender);
        call.raw = [permit];
        call.args = [
          { name: "token", type: "address", value: permit.details.token, display: displayAddress(permit.details.token, token?.symbol) },
          { name: "amount", type: "uint160", value: permit.details.amount.toString(), display: displayAmount(permit.details.amount, token, { permit2: true }) },
          { name: "expiration", type: "uint48", value: permit.details.expiration.toString() },
          { name: "spender", type: "address", value: permit.spender, display: displayAddress(permit.spender, spender.name) },
        ];
      } else if (name === "PERMIT2_PERMIT_BATCH") {
        const [permit] = decodeAbiParameters(PERMIT_BATCH_PARAMS, input);
        call.raw = [permit];
        call.args = [{ name: "permit", type: "tuple", value: stringify(permit) }];
      } else if (name === "TRANSFER" || name === "SWEEP" || name === "PAY_PORTION") {
        const [token, recipient, value] = decodeAbiParameters(TRANSFER_PARAMS, input);
        const t = await deps.contracts.token(token);
        call.raw = [token, recipient, value];
        call.args = [
          { name: "token", type: "address", value: token, display: displayAddress(token, t?.symbol) },
          { name: "recipient", type: "address", value: recipient, display: displayAddress(recipient) },
          { name: name === "PAY_PORTION" ? "bips" : "amount", type: "uint256", value: value.toString(), display: name === "PAY_PORTION" ? `${value} bips` : displayAmount(value, t) },
        ];
      }
    } catch {
      // Leave the command listed without arguments.
    }
    out.push(call);
  }
  return out;
}

/** Depth-first list of a call and everything nested in it. */
export function flattenCalls(calls: DecodedCall[]): DecodedCall[] {
  return calls.flatMap((c) => [c, ...flattenCalls(c.inner)]);
}
