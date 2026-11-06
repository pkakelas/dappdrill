/** Which ERC-20 balances an eth_call asks for: balanceOf(holder), on its own or inside a Multicall batch. */
import { decodeFunctionData, parseAbi } from "viem";
import type { Hex } from "../types.js";

export interface BalanceRead {
  token: Hex;
  holder: Hex;
}

const BALANCE_OF = "0x70a08231";
const MULTICALL = parseAbi([
  "struct Call { address target; bytes callData; }",
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Call3Value { address target; bool allowFailure; uint256 value; bytes callData; }",
  "function aggregate(Call[] calls)",
  "function blockAndAggregate(Call[] calls)",
  "function tryAggregate(bool requireSuccess, Call[] calls)",
  "function tryBlockAndAggregate(bool requireSuccess, Call[] calls)",
  "function aggregate3(Call3[] calls)",
  "function aggregate3Value(Call3Value[] calls)",
]);

export function balanceReads(method: string, params: unknown[]): BalanceRead[] {
  if (method !== "eth_call") return [];
  const tx = params[0] as { to?: unknown; data?: unknown; input?: unknown } | undefined;
  const data = tx?.data ?? tx?.input;
  if (typeof tx?.to !== "string" || typeof data !== "string") return [];
  const own = single(tx.to, data);
  if (own) return [own];
  // Cheap to rule out: a batch that holds a balanceOf holds its selector.
  if (!data.includes(BALANCE_OF.slice(2))) return [];
  try {
    const { args } = decodeFunctionData({ abi: MULTICALL, data: data as Hex });
    const calls = (args as readonly unknown[]).find(Array.isArray) as { target: string; callData: string }[] | undefined;
    return (calls ?? []).flatMap((c) => single(c.target, c.callData) ?? []);
  } catch {
    return [];
  }
}

function single(to: string, data: string): BalanceRead | undefined {
  if (data.length !== 74 || !data.toLowerCase().startsWith(BALANCE_OF)) return undefined;
  return { token: to.toLowerCase() as Hex, holder: `0x${data.slice(34).toLowerCase()}` };
}
