/**
 * Routes the page's own JSON-RPC traffic (fetch/XHR and WebSocket) to the
 * chain controller, so reads hit the fork the wallet writes to. Non-RPC
 * traffic and chains we don't run pass through untouched.
 */
import type { BrowserContext, Route, Request, WebSocketRoute } from "playwright";
import { nowIso, type RpcLogEntry } from "@dappdrill/core";
import type { ChainController } from "../types.js";
import { probeChainId, toRpcError } from "../chain/rpc.js";

interface RpcItem {
  jsonrpc?: string;
  id?: unknown;
  method: string;
  params?: unknown[];
}

export interface RpcRouterOptions {
  chains: ChainController;
  onLog: (entry: RpcLogEntry) => void;
  onActivity?: () => void;
}

export class RpcRouter {
  private readonly byUrl = new Map<string, number>();
  private readonly byHost = new Map<string, number>();

  constructor(private readonly opts: RpcRouterOptions) {
    for (const c of opts.chains.configs()) this.remember(c.rpcUrl, c.id);
    for (const c of opts.chains.configs()) this.remember(opts.chains.rpcUrl(c.id), c.id);
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route("**/*", (route, request) => this.handleHttp(route, request));
    await context.routeWebSocket("**/*", (ws) => this.handleWs(ws));
  }

  /** First mapping wins: when two configured chains share an endpoint (forks of one node), the first config is the test's chain. */
  private remember(url: string, chainId: number): void {
    const key = normalise(url);
    if (!this.byUrl.has(key)) this.byUrl.set(key, chainId);
    try {
      const host = new URL(url).host;
      if (!this.byHost.has(host)) this.byHost.set(host, chainId);
    } catch {
      /* not a URL */
    }
  }

  /** Chain id an endpoint serves: known from config or the provider's hostname, else probed once with eth_chainId. */
  async chainFor(url: string): Promise<number | undefined> {
    const key = normalise(url);
    const known = this.byUrl.get(key) ?? providerChain(url);
    if (known !== undefined) return known;
    if (!/^https?:/.test(url)) return this.byHost.get(safeHost(url));
    const probed = await probeChainId(url);
    if (probed !== undefined) this.remember(url, probed);
    return probed;
  }

  private async handleHttp(route: Route, request: Request): Promise<void> {
    const method = request.method();
    const url = request.url();
    if (method === "OPTIONS" && (this.byUrl.has(normalise(url)) || this.byHost.has(safeHost(url)))) {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (method !== "POST") return route.fallback();
    const body = parseRpc(request.postData());
    if (!body) return route.fallback();
    this.opts.onActivity?.();

    const chainId = (await this.chainFor(url)) ?? (await this.learnFromPage(route, url, body.items));
    if (chainId === undefined || !this.opts.chains.has(chainId)) {
      // A chain we don't run: let the page talk to the real endpoint, but keep the log.
      for (const item of body.items) this.opts.onLog({ chainId, url, method: item.method, via: "page", durationMs: 0, at: nowIso() });
      return route.fallback();
    }

    const answers = await Promise.all(body.items.map((item) => this.answer(chainId, url, item)));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", ...corsHeaders(request) },
      body: JSON.stringify(body.batch ? answers : answers[0]),
    });
  }

  /**
   * Endpoints that only answer the dApp's own origin (app-side RPC proxies)
   * fail our probe. When the page itself asks such an endpoint for eth_chainId,
   * send that request as-is and learn the chain from the answer, so the rest
   * of its calls go to the fork. The probing request is answered by the fork too.
   */
  private async learnFromPage(route: Route, url: string, items: RpcItem[]): Promise<number | undefined> {
    const ask = items.find((i) => i.method === "eth_chainId");
    if (!ask) return undefined;
    try {
      const res = await route.fetch({ timeout: 10_000 });
      const answers = [(await res.json()) as unknown].flat() as { id?: unknown; result?: unknown }[];
      const result = answers.find((a) => a?.id === ask.id)?.result;
      if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) return undefined;
      const chainId = Number.parseInt(result, 16);
      this.remember(url, chainId);
      return chainId;
    } catch {
      return undefined;
    }
  }

  private async answer(chainId: number, url: string, item: RpcItem): Promise<unknown> {
    const started = Date.now();
    const base = { jsonrpc: "2.0", id: item.id ?? null };
    try {
      const result = await this.opts.chains.request(chainId, item.method, item.params ?? []);
      this.opts.onLog({ chainId, url, method: item.method, via: "page", durationMs: Date.now() - started, at: nowIso() });
      return { ...base, result };
    } catch (e) {
      const error = toRpcError(e);
      this.opts.onLog({ chainId, url, method: item.method, via: "page", durationMs: Date.now() - started, error: `${error.code} ${error.message}`, at: nowIso() });
      return { ...base, error };
    }
  }

  private handleWs(ws: WebSocketRoute): void {
    const chainId = this.byHost.get(safeHost(ws.url()));
    if (chainId === undefined || !this.opts.chains.has(chainId)) {
      ws.connectToServer();
      return;
    }
    ws.onMessage(async (message) => {
      const body = parseRpc(typeof message === "string" ? message : message.toString());
      if (!body) return;
      this.opts.onActivity?.();
      const answers = await Promise.all(
        body.items.map((item) =>
          item.method === "eth_subscribe" || item.method === "eth_unsubscribe"
            ? { jsonrpc: "2.0", id: item.id ?? null, error: { code: -32601, message: `${item.method} is not available on this connection` } }
            : this.answer(chainId, ws.url(), item),
        ),
      );
      ws.send(JSON.stringify(body.batch ? answers : answers[0]));
    });
  }
}

function parseRpc(raw: string | null): { items: RpcItem[]; batch: boolean } | undefined {
  if (!raw || raw.length > 2_000_000) return undefined;
  const t = raw.trimStart();
  if (t[0] !== "{" && t[0] !== "[") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return undefined;
  }
  const isItem = (x: unknown): x is RpcItem => typeof x === "object" && x !== null && typeof (x as RpcItem).method === "string" && "jsonrpc" in (x as object);
  if (Array.isArray(parsed)) return parsed.length > 0 && parsed.every(isItem) ? { items: parsed, batch: true } : undefined;
  return isItem(parsed) ? { items: [parsed], batch: false } : undefined;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers()["origin"] ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "content-type",
  };
}

/**
 * Hosted RPC providers name the network in the hostname (Alchemy, Infura) or
 * the first path segment (dRPC). A dApp's own key is
 * often locked to its origin, so our probe can't ask, and a page that never
 * calls eth_chainId gives nothing to learn from.
 */
const PROVIDER_NETWORKS: Record<string, Record<string, number>> = {
  "g.alchemy.com": {
    "eth-mainnet": 1, "eth-sepolia": 11155111, "base-mainnet": 8453, "base-sepolia": 84532, "arb-mainnet": 42161,
    "arb-sepolia": 421614, "opt-mainnet": 10, "opt-sepolia": 11155420, "polygon-mainnet": 137,
  },
  "infura.io": {
    mainnet: 1, sepolia: 11155111, "base-mainnet": 8453, "base-sepolia": 84532, "arbitrum-mainnet": 42161,
    "arbitrum-sepolia": 421614, "optimism-mainnet": 10, "optimism-sepolia": 11155420, "polygon-mainnet": 137,
  },
};
const DRPC_HOSTS = new Set(["lb.drpc.org", "lb.drpc.live"]);
const DRPC_NETWORKS: Record<string, number> = {
  ethereum: 1, sepolia: 11155111, base: 8453, "base-sepolia": 84532, arbitrum: 42161, "arbitrum-sepolia": 421614, optimism: 10, polygon: 137,
};

export function providerChain(url: string): number | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (DRPC_HOSTS.has(host)) return DRPC_NETWORKS[parsed.pathname.split("/")[1]?.toLowerCase() ?? ""];
  for (const [domain, networks] of Object.entries(PROVIDER_NETWORKS)) {
    if (!host.endsWith(`.${domain}`)) continue;
    return networks[host.slice(0, -domain.length - 1)];
  }
  return undefined;
}

function normalise(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
