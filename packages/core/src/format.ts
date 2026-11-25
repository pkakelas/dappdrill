import { chainInfo, chainName } from "./chains.js";
import type { Blocked, Fund, MissingChain } from "./run.js";

/** 0x9f3a…c2e1 */
export function shortAddress(addr: string | undefined, chars = 4): string {
  if (!addr) return "";
  if (addr.length <= 2 + chars * 2) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

/** "0.05 ETH on Base Sepolia", or the token by its address when its symbol isn't known. */
export function fundText(f: Fund): string {
  return `${f.amount} ${f.symbol ?? (f.token ? `of the token ${shortAddress(f.token)}` : (chainInfo(f.chainId)?.nativeSymbol ?? "of the chain's coin"))} on ${chainName(f.chainId)}`;
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

/** Where an owner learns to let our browser past their bot check. */
export const BOT_GUIDE_URL = "https://dappdrill.com/bot";

/** Why the wallet couldn't use a chain the app asked for, and what to do about it. */
export function missingChainLine(c: MissingChain): string {
  const chain = c.name ? `${c.name} (chain ${c.chainId})` : `chain ${c.chainId}`;
  return `The app needs ${chain}${c.rpcUrl ? `, RPC ${c.rpcUrl}` : ""}, but the test wallet couldn't add it: ${c.reason}. Add it under Settings → Chains with an RPC that answers for it.`;
}
