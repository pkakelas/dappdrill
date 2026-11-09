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
/** The part of NOISE that also signs users in. */
const SIGN_IN = /privy|walletconnect|web3modal|reown/i;
const RATE_LIMITED = /\b429\b|rate.?limit|too many requests|exceeded .*(limit|quota)|capacity/i;
const ADDRESS = /0x[0-9a-f]{40}/g;
const TIMED_OUT = /timed? ?out|timeout|ETIMEDOUT/i;
const PRUNED = /missing trie node|archive.*not available|pruned|header not found|historical state|state .*not available|unknown block|block not found/i;
/** In order of precedence: the first cause any error shows names the chain's failure. */
const CAUSES = [["rate-limited", RATE_LIMITED], ["pruned", PRUNED], ["timed-out", TIMED_OUT]] as const;

/** An error answer is short; anything longer is a page, not a reason. */
const MAX_REFUSAL = 2_000;
const MAX_REFUSALS = 50;

interface HostStats {
  failed: number;
  statuses: Set<number>;
}

export class Traffic {
  private readonly open = new Map<Request, { host: string; at: number }>();
  private readonly hosts = new Map<string, HostStats>();
  private readonly seen = new Set<string>();
  /** Which hosts were told about each address. */
  private readonly told = new Map<string, Set<string>>();
  /** Error answers that said why, newest last. */
  private readonly refusals: { host: string; status: number; said: string; at: number }[] = [];

  install(context: BrowserContext): void {
    context.on("request", (r) => {
      const host = tracked(r);
      if (!host) return;
      this.open.set(r, { host, at: Date.now() });
      this.seen.add(new URL(r.url()).origin);
      for (const [address] of `${r.url()} ${r.postData() ?? ""}`.toLowerCase().matchAll(ADDRESS)) {
        this.told.set(address, (this.told.get(address) ?? new Set()).add(host));
      }
    });
    context.on("requestfinished", (r) => {
      const entry = this.open.get(r);
      this.open.delete(r);
      // A sign-in provider's noise is left out of the stall counts, but its "no" is what a failed login needs.
      const host = entry?.host ?? saysWhy(r);
      if (!host) return;
      void r.response().then(
        (res) => {
          if (!res || res.status() < 400) return;
          if (entry) this.fail(entry.host, res.status());
          const status = res.status();
          void res.text().then(
            (body) => {
              const said = refusalIn(body);
              if (said) this.refusals.push({ host, status, said, at: Date.now() });
              if (this.refusals.length > MAX_REFUSALS) this.refusals.shift();
            },
            () => {},
          );
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

  /** Servers that refused something since `at` and said why: "auth.privy.io answered 400: “User limit reached”". */
  refusedSince(at: number): string[] {
    const lines = this.refusals.filter((r) => r.at >= at).map((r) => `${r.host} answered ${r.status}: “${r.said}”`);
    return [...new Set(lines)].slice(0, 2);
  }

  /** Backends the page sent this address to: the ones that may answer for it from the real chain. */
  hostsTold(address: string): string[] {
    return [...(this.told.get(address.toLowerCase()) ?? [])];
  }

  /** Origins the page fetched from, ones on the app's own site (e.g. app.x.dev → node.x.dev) first. */
  origins(appUrl: string): string[] {
    const site = siteOf(new URL(appUrl).hostname);
    const all = [...this.seen];
    const own = all.filter((o) => siteOf(new URL(o).hostname) === site);
    return [...own, ...all.filter((o) => !own.includes(o))];
  }

  private fail(host: string, status?: number): void {
    const s = this.hosts.get(host) ?? { failed: 0, statuses: new Set<number>() };
    s.failed++;
    if (status) s.statuses.add(status);
    this.hosts.set(host, s);
  }
}

function tracked(r: Request): string | undefined {
  return NOISE.test(r.url()) ? undefined : asked(r);
}

/** A wallet or sign-in provider (in NOISE for its relays) whose error answer is still worth reading; its event reporting is not. */
function saysWhy(r: Request): string | undefined {
  return SIGN_IN.test(r.url()) && !/analytics|telemetry|metrics|events?\b/i.test(r.url()) ? asked(r) : undefined;
}

/** The host of a fetch or XHR of the page's own, JSON-RPC apart. */
function asked(r: Request): string | undefined {
  const type = r.resourceType();
  if (type !== "fetch" && type !== "xhr") return undefined;
  if (/"jsonrpc"\s*:/.test(r.postData() ?? "")) return undefined;
  try {
    const url = new URL(r.url());
    return /^https?:$/.test(url.protocol) ? url.host : undefined;
  } catch {
    return undefined;
  }
}

/** The reason an error answer gives, when it is JSON with one: {"error":"User limit reached"}, {"error":{"message":…}}, {"message":…}. */
export function refusalIn(body: string): string | undefined {
  if (body.length > MAX_REFUSAL) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const reason = (node: unknown, depth = 0): string | undefined => {
    if (typeof node === "string") return node.trim() || undefined;
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > 1) return undefined;
    const o = node as Record<string, unknown>;
    for (const key of ["error", "message", "error_description", "detail", "reason"]) {
      const found = reason(o[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return typeof json === "string" ? undefined : reason(json)?.slice(0, 160);
}

/** The last two labels of a hostname: good enough to tell the app's own hosts from third parties. */
function siteOf(hostname: string): string {
  return hostname.split(".").slice(-2).join(".");
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
  return rpc.length || backends.length ? { chains: [], backends, rpc } : undefined;
}
