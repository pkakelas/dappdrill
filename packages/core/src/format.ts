import type { Blocked, Stalled } from "./run.js";

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

/** Where an owner learns to let DappDrill past their bot protection. */
export const BOT_GUIDE_URL = "https://dappdrill.com/bot";

/** "Blocked by Cloudflare's bot check" */
export function describeBlock(b: Blocked): string {
  return `Blocked by ${b.provider ? `${b.provider}'s` : "a"} bot check`;
}

/** The full sentence reports show for a blocked scan. */
export function blockedLine(b: Blocked): string {
  return `${describeBlock(b)} at ${b.url}, so exploring stopped there. DappDrill doesn't solve CAPTCHAs; let it in with an allowlist header: ${BOT_GUIDE_URL}`;
}

/** Where an owner learns to make their app's data load on a fork. */
export const FORK_GUIDE_URL = "https://dappdrill.com/fork";

/** One sentence per thing the app was waiting on, most likely cause first. */
export function stallReasons(s: Stalled): string[] {
  // Rows saved before missing chains were reported have no `chains`.
  const chains = (s.chains ?? []).map(
    (c) =>
      `The app needs ${c.name ? `${c.name} (chain ${c.chainId})` : `chain ${c.chainId}`}${c.rpcUrl ? `, RPC ${c.rpcUrl}` : ""}, but the test wallet couldn't add it: ${c.reason}.`,
  );
  const reasons = s.rpc.map((r) => {
    const reads = `${r.errors} failed ${r.errors === 1 ? "read" : "reads"}`;
    if (r.cause === "rate-limited") return `The test chain ${r.chainId} was rate-limited by the RPC it forks from (${reads}). Fork from a dedicated RPC.`;
    if (r.cause === "pruned") return `The RPC that chain ${r.chainId} forks from no longer serves the forked block's state (${reads}). Fork from an archive node.`;
    if (r.cause === "timed-out") return `The RPC that chain ${r.chainId} forks from was too slow to answer (${reads}). Fork from a dedicated RPC.`;
    return `Reads on test chain ${r.chainId} failed (${reads}, e.g. "${r.sample}").`;
  });
  if (s.backends.length) {
    const hosts = s.backends.map((b) => {
      const what = [b.failed && `${b.failed} failed`, b.hung && `${b.hung} never answered`].filter(Boolean).join(", ");
      const codes = b.statuses.length ? `, HTTP ${b.statuses.join("/")}` : "";
      return `${b.host} (${what}${codes})`;
    });
    reasons.push(`The page was waiting on ${hosts.join(", ")}. Backends like these read the real chain, not the fork, unless the app points them elsewhere.`);
  }
  return [...chains, ...reasons];
}

/** True when the scan stopped because the app needs a chain the wallet couldn't add. */
export function missesChain(s: Stalled): boolean {
  return (s.chains ?? []).length > 0;
}

/** The full sentence reports show when a scan found nothing because the data never loaded. */
export function stalledLine(s: Stalled): string {
  if (missesChain(s)) return `The app needs a chain the test wallet couldn't use, so exploring stopped there. ${stallReasons(s).join(" ")} Add it to the app's chains in scan settings with an RPC that answers for it.`;
  return `The app's data didn't load, so there was nothing to test. ${stallReasons(s).join(" ")} How to fix it: ${FORK_GUIDE_URL}`;
}
