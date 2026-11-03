/**
 * The page's own fetch/XHR traffic per host, so a scan that found nothing can
 * say what the app was waiting on. JSON-RPC is left out: the fork answers it
 * and the RPC log already records it.
 */
import type { BrowserContext, Request } from "playwright";
import type { RpcLogEntry, Stalled } from "@dappdrill/core";

/** A request still open after this long counts as one that never answered. */
const HUNG_MS = 10_000;
const MAX_BACKENDS = 5;
/** Analytics, error reporting and wallet relays fail all the time without the app noticing. */
const NOISE = /sentry|google-analytics|analytics\.google|googletagmanager|doubleclick|adnxs|launchdarkly|segment\.(io|com)|mixpanel|amplitude|hotjar|posthog|datadoghq|intercom|cloudflareinsights|vercel-insights|walletconnect|web3modal|reown|privy|coinbase\.com\/.*metrics/i;
const RATE_LIMITED = /\b429\b|rate.?limit|too many requests|exceeded .*(limit|quota)|capacity/i;
const TIMED_OUT = /timed? ?out|timeout|ETIMEDOUT/i;
const PRUNED = /missing trie node|archive.*not available|pruned|header not found|historical state|state .*not available|unknown block|block not found/i;
/** In order of precedence: the first cause any error shows names the chain's failure. */
const CAUSES = [["rate-limited", RATE_LIMITED], ["pruned", PRUNED], ["timed-out", TIMED_OUT]] as const;

interface HostStats {
  failed: number;
  statuses: Set<number>;
}

export class Traffic {
  private readonly open = new Map<Request, { host: string; at: number }>();
  private readonly hosts = new Map<string, HostStats>();

  install(context: BrowserContext): void {
    context.on("request", (r) => {
      const host = tracked(r);
      if (host) this.open.set(r, { host, at: Date.now() });
    });
    context.on("requestfinished", (r) => {
      const entry = this.open.get(r);
      if (!entry) return;
      this.open.delete(r);
      void r.response().then(
        (res) => {
          if (res && res.status() >= 400) this.fail(entry.host, res.status());
        },
        () => {},
      );
    });
    context.on("requestfailed", (r) => {
      const entry = this.open.get(r);
      if (!entry) return;
      this.open.delete(r);
      // Navigations abort whatever the old page had in flight; that isn't the backend's fault.
      if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) this.fail(entry.host);
    });
  }

  /** Hosts with failed or hung requests, worst first. */
  backends(now = Date.now()): Stalled["backends"] {
    const hung = new Map<string, number>();
    for (const { host, at } of this.open.values()) if (now - at >= HUNG_MS) hung.set(host, (hung.get(host) ?? 0) + 1);
    const names = new Set([...this.hosts.keys(), ...hung.keys()]);
    return [...names]
      .map((host) => ({
        host,
        failed: this.hosts.get(host)?.failed ?? 0,
        hung: hung.get(host) ?? 0,
        statuses: [...(this.hosts.get(host)?.statuses ?? [])].sort(),
      }))
      .sort((a, b) => b.failed + b.hung - (a.failed + a.hung))
      .slice(0, MAX_BACKENDS);
  }

  private fail(host: string, status?: number): void {
    const s = this.hosts.get(host) ?? { failed: 0, statuses: new Set<number>() };
    s.failed++;
    if (status) s.statuses.add(status);
    this.hosts.set(host, s);
  }
}

function tracked(r: Request): string | undefined {
  const type = r.resourceType();
  if (type !== "fetch" && type !== "xhr") return undefined;
  if (/"jsonrpc"\s*:/.test(r.postData() ?? "")) return undefined;
  let url: URL;
  try {
    url = new URL(r.url());
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol) || NOISE.test(r.url())) return undefined;
  return url.host;
}

/** Failed fork reads per chain we run, with the cause when the upstream error names it. */
export function rpcFailures(log: RpcLogEntry[], chainIds: number[]): Stalled["rpc"] {
  const byChain = new Map<number, string[]>();
  for (const e of log) {
    if (!e.error || e.chainId === undefined || !chainIds.includes(e.chainId)) continue;
    byChain.set(e.chainId, [...(byChain.get(e.chainId) ?? []), e.error]);
  }
  return [...byChain].map(([chainId, errors]) => {
    const [cause, re] = CAUSES.find(([, re]) => errors.some((m) => re.test(m))) ?? [];
    const sample = (errors.find((m) => re?.test(m)) ?? errors[0]!).slice(0, 160);
    return { chainId, errors: errors.length, ...(cause ? { cause } : {}), sample };
  });
}

/** What the app was waiting on, or undefined when nothing failed (then the app simply had nothing to do). */
export function diagnoseStall(traffic: Traffic, log: RpcLogEntry[], chainIds: number[]): Stalled | undefined {
  const rpc = rpcFailures(log, chainIds);
  const backends = traffic.backends();
  return rpc.length || backends.length ? { backends, rpc } : undefined;
}
