import type { Blocked, MissingChain } from "./run.js";

/** 0x9f3a…c2e1 */
export function shortAddress(addr: string | undefined, chars = 4): string {
  if (!addr) return "";
  if (addr.length <= 2 + chars * 2) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** 1500000 with 6 decimals -> "1.5" */
export function formatUnitsPlain(raw: bigint, decimals: number, maxFraction = 4): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  const s = whole.toLocaleString("en-US") + (frac ? `.${frac}` : "");
  return neg ? `-${s}` : s;
}

/** "Blocked by Cloudflare's bot check" */
export function describeBlock(b: Blocked): string {
  return b.provider ? `Blocked by ${b.provider}'s bot check` : "Blocked";
}

/** Where an owner learns to make their app's data load on a fork. */
export const BOT_GUIDE_URL = "https://dappdrill.com/bot";
export const FORK_GUIDE_URL = "https://dappdrill.com/fork";

/** Why a test couldn't run: the app gets the wallet's funds from a backend that reads the real chain. */
export function forkBlindLine(reason: string, hosts: string[]): string {
  return `${reason} The app asks ${hosts.join(", ")} about this wallet, and backends like these read the real chain, not the fork. How to fix it: ${FORK_GUIDE_URL}`;
}

/**
 * Why a test on a copy can't say the app is wrong: after our wallet signed on the copy, the app's server
 * acted for it on the real chain, which the copy never sees, so the copy was behind the real chain from then on.
 */
export function copyBehindLine(chains: string[]): string {
  const names = chains.join(" and ");
  return `After our wallet signed on the copy of ${names}, the app's server acted for it on the real chain, which the copy never sees, so the copy was behind the real chain for the rest of this run. The next run copies ${names} at its latest block: run the test again.`;
}

/** Why the wallet couldn't use a chain the app asked for, and what to do about it. */
export function missingChainLine(c: MissingChain): string {
  const chain = c.name ? `${c.name} (chain ${c.chainId})` : `chain ${c.chainId}`;
  return `The app needs ${chain}${c.rpcUrl ? `, RPC ${c.rpcUrl}` : ""}, but the test wallet couldn't add it: ${c.reason}. Add it under Settings → Chains with an RPC that answers for it.`;
}
