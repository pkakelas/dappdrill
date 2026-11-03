/** Display helpers shared by the decoders and the prose. */
import { maxUint160, maxUint256, type Address } from "viem";
import { formatUnitsPlain, shortAddress } from "@dappdrill/core";
import type { TokenInfo } from "./contract.js";

/** 2^255: anything this large is an "unlimited" approval in practice. */
const UNLIMITED_FLOOR = 1n << 255n;

export interface UnlimitedOptions {
  /** Permit2 amounts are uint160, so its max is the unlimited marker. */
  permit2?: boolean;
  totalSupply?: bigint;
}

export function isUnlimited(amount: bigint, opts: UnlimitedOptions = {}): boolean {
  if (amount >= UNLIMITED_FLOOR) return true;
  if (opts.permit2 && amount === maxUint160) return true;
  // More than every token in existence is unlimited for all practical purposes.
  if (opts.totalSupply !== undefined && opts.totalSupply > 0n && amount > opts.totalSupply) return true;
  return false;
}

export function displayAmount(amount: bigint, token?: Pick<TokenInfo, "symbol" | "decimals"> | undefined, opts: UnlimitedOptions = {}): string {
  if (isUnlimited(amount, opts)) {
    const marker = amount === maxUint256 ? " (2²⁵⁶ − 1)" : opts.permit2 && amount === maxUint160 ? " (2¹⁶⁰ − 1)" : "";
    return `Unlimited${marker}`;
  }
  const symbol = token?.symbol ? ` ${token.symbol}` : "";
  if (token?.decimals === undefined) return `${amount.toString()}${symbol ? ` (raw${symbol})` : ""}`;
  return `${formatUnitsPlain(amount, token.decimals)}${symbol}`;
}

export function displayNative(wei: bigint, symbol = "ETH"): string {
  return `${formatUnitsPlain(wei, 18, 6)} ${symbol}`;
}

export function displayAddress(address: Address | string, name?: string): string {
  return name ? `${shortAddress(address)} (${name})` : shortAddress(address);
}

/** JSON-friendly rendering of decoded values (bigints as decimal strings). */
export function plain(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

export function stringify(value: unknown): string {
  const p = plain(value);
  return typeof p === "string" ? p : JSON.stringify(p);
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function daysAgo(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 60) return `${Math.floor(days)} days ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
