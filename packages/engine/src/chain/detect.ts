/**
 * Find out which chains a dApp talks to by loading it once with the wallet in
 * probe mode: record the JSON-RPC endpoints the page POSTs to (resolved to
 * chain ids with eth_chainId) and the chains it asks the wallet to switch to.
 */
import { chromium } from "playwright";
import { chainInfo, type ChainConfig } from "@dappdrill/core";
import { BINDING_NAME, walletInitScript, type BridgeRequest, type BridgeResponse } from "../wallet/inject.js";
import { WalletErrors } from "../wallet/errors.js";
import { probeChainId, rpcCall, toHex, toRpcError } from "./rpc.js";

export interface DetectChainsOptions {
  headless?: boolean;
  /** How long to watch the page after it loads (default 10s). */
  settleMs?: number;
  /** Chain the probe wallet starts on (default 1). */
  startChainId?: number;
  /** Max chains returned (default 4). */
  maxChains?: number;
  log?: (message: string) => void;
}

const PROBE_ADDRESS = "0x000000000000000000000000000000000000d411";
const PASSTHROUGH_CAP = 30;

export async function detectChains(url: string, opts: DetectChainsOptions = {}): Promise<ChainConfig[]> {
  const log = opts.log ?? (() => {});
  const endpoints = new Map<string, number>(); // url -> request count
  const switches: number[] = [];
  let current = opts.startChainId ?? 1;
  let passthrough = 0;

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.exposeBinding(BINDING_NAME, async (_source, req: BridgeRequest): Promise<BridgeResponse> => {
      try {
        return await probeHandle(req);
      } catch (e) {
        return { error: toRpcError(e) };
      }
    });
    await context.addInitScript({
      content: walletInitScript({ wallets: [{ id: "metamask", uuid: crypto.randomUUID() }], chainId: toHex(current), accounts: [], binding: BINDING_NAME }),
    });
    await context.route("**/*", (route, request) => {
      if (request.method() === "POST" && looksLikeRpc(request.postData())) {
        const u = tidyUrl(request.url());
        endpoints.set(u, (endpoints.get(u) ?? 0) + 1);
      }
      return route.fallback();
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: opts.settleMs ?? 10_000 }).catch(() => {});
    await page.waitForTimeout(Math.min(3_000, opts.settleMs ?? 10_000));
  } finally {
    await browser.close().catch(() => {});
  }

  async function probeHandle(req: BridgeRequest): Promise<BridgeResponse> {
    const params = Array.isArray(req.params) ? req.params : [];
    switch (req.method) {
      case "__state":
        return { result: { chainId: toHex(current), accounts: [] } };
      case "__click":
        return { result: null };
      case "eth_chainId":
        return { result: toHex(current) };
      case "net_version":
        return { result: String(current) };
      case "eth_accounts":
        return { result: [] };
      case "eth_requestAccounts":
      case "wallet_requestPermissions":
        // Connecting makes most dApps start reading balances on their chains, which is the signal we want.
        return { result: req.method === "eth_requestAccounts" ? [PROBE_ADDRESS] : [], emit: [{ event: "accountsChanged", args: [PROBE_ADDRESS] }] };
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        const id = Number.parseInt(String((params[0] as { chainId?: string })?.chainId ?? "0x0"), 16);
        if (!id) throw WalletErrors.invalidParams("chainId");
        switches.push(id);
        current = id;
        return { result: null, emit: [{ event: "chainChanged", args: toHex(id) }] };
      }
      default: {
        if (req.method.startsWith("eth_sign") || req.method === "personal_sign" || req.method === "eth_sendTransaction" || req.method === "wallet_sendCalls") {
          throw WalletErrors.userRejected();
        }
        if (req.method.startsWith("wallet_")) return { result: null };
        const known = chainInfo(current);
        if (!known || passthrough >= PASSTHROUGH_CAP) throw WalletErrors.chainDisconnected(current);
        passthrough++;
        return { result: await rpcCall(known.rpcUrl, req.method, params, { timeoutMs: 15_000 }) };
      }
    }
  }

  // Resolve endpoints to chain ids, most-used first.
  const reads = new Map<number, { count: number; endpoint: string }>();
  const sorted = [...endpoints.entries()].sort((a, b) => b[1] - a[1]);
  for (const [endpoint, count] of sorted) {
    if (!/^https?:/.test(endpoint)) continue;
    const id = await probeChainId(endpoint);
    if (id === undefined) continue;
    const prev = reads.get(id);
    if (!prev) reads.set(id, { count, endpoint });
    else prev.count += count;
  }
  log(`detect: ${sorted.length} RPC endpoint(s), chains read ${[...reads.keys()].join(", ") || "none"}, switches to ${switches.join(", ") || "none"}`);

  const ordered: number[] = [...reads.entries()].sort((a, b) => b[1].count - a[1].count).map(([id]) => id);
  for (const id of switches) if (!ordered.includes(id)) ordered.push(id);

  const configs: ChainConfig[] = [];
  for (const id of ordered) {
    const info = chainInfo(id);
    const rpcUrl = reads.get(id)?.endpoint ?? info?.rpcUrl;
    if (!rpcUrl) continue; // the dApp asked for a chain we know nothing about and never read from
    configs.push({ id, name: info?.name, rpcUrl, mode: info && !info.forkable ? "live" : "fork" });
  }
  return configs.slice(0, opts.maxChains ?? 4);
}

function looksLikeRpc(body: string | null): boolean {
  if (!body) return false;
  const t = body.trimStart();
  return (t.startsWith("{") || t.startsWith("[")) && t.includes('"jsonrpc"') && t.includes('"method"');
}

/** Browsers add a trailing slash to bare origins; keep the URL the way a config would spell it. */
function tidyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" && !u.search ? u.origin : url;
  } catch {
    return url;
  }
}
