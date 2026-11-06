import { encodeAbiParameters, encodeFunctionData, decodeFunctionResult, keccak256, pad, toHex as viemToHex } from "viem";
import type { Hex } from "../types.js";
import { JsonRpcError } from "./rpc.js";

const BALANCE_OF_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/**
 * Find the storage slot that backs `balanceOf(address)` by trial: write a
 * candidate slot, read balanceOf, restore if it didn't change. The slots that
 * balanceOf itself reads are tried first: that is one or two reads from the
 * fork's upstream whatever the token's layout, where guessing costs dozens and
 * runs into public RPCs' rate limits. The guesses cover the Solidity layout
 * keccak(addr . slot) and the Vyper layout keccak(slot . addr) for the first
 * 40 base slots. Proxies (USDC, USDT on some chains) work because the storage
 * lives on the proxy address regardless of the layout.
 */
export async function dealErc20(rpc: Rpc, token: Hex, holder: Hex, amount: bigint): Promise<void> {
  if (amount >= 1n << 255n) throw new Error("amount must fit in 255 bits (some tokens pack flags into the top bit)");
  const before = await readBalance(rpc, token, holder);
  if (before === undefined) throw new Error(`${token} does not look like an ERC-20 (balanceOf reverted)`);
  if (before === amount) return;

  const want = pad(viemToHex(amount), { size: 32 });
  const works = async (key: Hex): Promise<boolean> => {
    const original = (await rpc("eth_getStorageAt", [token, key, "latest"])) as Hex;
    await rpc("anvil_setStorageAt", [token, key, want]);
    if ((await readBalance(rpc, token, holder)) === amount) return true;
    await rpc("anvil_setStorageAt", [token, key, pad(original, { size: 32 })]);
    return false;
  };
  const read = await slotsRead(rpc, token, holder);
  for (const key of read) if (await works(key)) return;
  for (let slot = 0n; slot < 40n; slot++) {
    for (const key of [solidityKey(holder, slot), vyperKey(holder, slot)]) {
      if (!read.includes(key) && (await works(key))) return;
    }
  }
  throw new Error(`could not find the balance slot of ${token}; it may store balances in a non-standard layout`);
}

/** The token's own storage slots that balanceOf(holder) reads, from the node's access list for the call. */
async function slotsRead(rpc: Rpc, token: Hex, holder: Hex): Promise<Hex[]> {
  try {
    const data = encodeFunctionData({ abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [holder] });
    const res = (await rpc("eth_createAccessList", [{ to: token, data }, "latest"])) as { accessList?: { address: string; storageKeys: Hex[] }[] };
    return (res.accessList ?? []).filter((a) => a.address.toLowerCase() === token.toLowerCase()).flatMap((a) => a.storageKeys);
  } catch {
    return [];
  }
}

export function solidityKey(addr: Hex, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [addr, slot]));
}

export function vyperKey(addr: Hex, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [slot, addr]));
}

export async function readBalance(rpc: Rpc, token: Hex, holder: Hex): Promise<bigint | undefined> {
  try {
    const data = encodeFunctionData({ abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [holder] });
    const out = (await rpc("eth_call", [{ to: token, data }, "latest"])) as Hex;
    if (!out || out === "0x") return undefined;
    return decodeFunctionResult({ abi: BALANCE_OF_ABI, functionName: "balanceOf", data: out });
  } catch (e) {
    if (e instanceof JsonRpcError) return undefined;
    throw e;
  }
}
