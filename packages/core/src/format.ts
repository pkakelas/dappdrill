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
