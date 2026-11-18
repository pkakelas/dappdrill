import { createPublicClient, http, type PublicClient } from "viem";
import { chainInfo, type ChainConfig, type MissingChain } from "@dappdrill/core";
import type { AddChainRequest, ChainController } from "../types.js";
import { JsonRpcError, probeChainId, rpcCall } from "./rpc.js";

export interface StartChainsOptions {
  log?: (message: string) => void;
  /** Called once a chain the app asked for is in use, before the wallet answers the app. */
  onAdded?: (config: ChainConfig) => Promise<void>;
  /** Called when a chain the app asked for couldn't be reached (the first time per chain). */
  onMissing?: (chain: MissingChain) => Promise<void>;
}

interface Entry {
  config: ChainConfig;
  client?: PublicClient;
}

/** The chains of a run, each reached through its own RPC. */
export function startChains(configs: ChainConfig[], opts: StartChainsOptions = {}): ChainController {
  const ids = new Set<number>();
  for (const c of configs) {
    if (ids.has(c.id)) throw new Error(`chain ${c.id} is configured twice`);
    ids.add(c.id);
    opts.log?.(`chain ${c.id}: ${c.rpcUrl}`);
  }
  return new Controller(configs, opts);
}

/** Hosts the page called that we try as RPCs for a chain the app wants. */
const MAX_HINTS = 6;

/**
 * The config for a chain the app asked for. A chain we know uses our RPC;
 * otherwise the first RPC the app offered, then the first host the page
 * called, that answers as that chain.
 */
export async function configForApp(req: AddChainRequest): Promise<ChainConfig> {
  const info = chainInfo(req.id);
  if (info) return { id: info.id, name: info.name, rpcUrl: info.rpcUrl, fromApp: true };
  const offered = req.rpcUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);
  const hints = (req.rpcHints ?? []).filter((u) => /^https?:\/\//i.test(u) && !offered.includes(u)).slice(0, MAX_HINTS);
  const candidates = [...offered, ...hints];
  if (candidates.length === 0) throw new Error("the app gave no RPC URL for it");
  const ids = await Promise.all(candidates.map((url) => probeChainId(url)));
  const url = candidates.find((_, i) => ids[i] === req.id);
  if (url) return { id: req.id, name: req.name, rpcUrl: url, fromApp: true };
  if (offered.length) throw new Error(`${offered[0]} didn't answer as chain ${req.id}`);
  const tried = hints.length === 1 ? "the one host the page called didn't answer" : `none of the ${hints.length} hosts the page called answered`;
  throw new Error(`the app gave no RPC URL for it, and ${tried} as chain ${req.id}`);
}

class Controller implements ChainController {
  private readonly entries = new Map<number, Entry>();
  private closed = false;
  private readonly adding = new Map<number, Promise<ChainConfig>>();
  private readonly missingChains = new Map<number, MissingChain>();

  constructor(configs: ChainConfig[], private readonly opts: StartChainsOptions) {
    for (const config of configs) this.entries.set(config.id, { config });
  }

  addFromApp(req: AddChainRequest): Promise<ChainConfig> {
    const known = this.entries.get(req.id);
    if (known) return Promise.resolve({ ...known.config });
    // The app often asks twice in a row (switch fails, add, retry); look for the chain once.
    let p = this.adding.get(req.id);
    if (!p) {
      p = this.add(req).finally(() => this.adding.delete(req.id));
      this.adding.set(req.id, p);
    }
    return p;
  }

  private async add(req: AddChainRequest): Promise<ChainConfig> {
    let config: ChainConfig;
    try {
      config = await configForApp(req);
      if (this.closed) throw new Error("the run had already ended");
    } catch (err) {
      const reason = (err as Error).message.split("\n")[0]!;
      // An offered RPC is worth naming; hosts we only guessed at aren't.
      const rpcUrl = req.rpcUrls.find((u) => /^https?:\/\//i.test(u));
      const first = !this.missingChains.has(req.id);
      const missing: MissingChain = { chainId: req.id, name: req.name ?? chainInfo(req.id)?.name, rpcUrl, reason };
      this.missingChains.set(req.id, missing);
      if (first) await this.opts.onMissing?.(missing).catch(() => {});
      throw err;
    }
    this.entries.set(req.id, { config });
    this.missingChains.delete(req.id);
    this.opts.log?.(`chain ${config.id}: ${config.rpcUrl} (the app asked for it)`);
    try {
      await this.opts.onAdded?.({ ...config });
    } catch (err) {
      this.opts.log?.(`chain ${req.id}: reporting the added chain failed: ${(err as Error).message}`);
    }
    return { ...config };
  }

  missing(): MissingChain[] {
    return [...this.missingChains.values()];
  }

  configs(): ChainConfig[] {
    return [...this.entries.values()].map((e) => ({ ...e.config }));
  }

  has(chainId: number): boolean {
    return this.entries.has(chainId);
  }

  rpcUrl(chainId: number): string {
    return this.entry(chainId).config.rpcUrl;
  }

  client(chainId: number): PublicClient {
    const e = this.entry(chainId);
    e.client ??= createPublicClient({ transport: http(e.config.rpcUrl, { retryCount: 1 }) });
    return e.client;
  }

  async request(chainId: number, method: string, params: unknown[]): Promise<unknown> {
    const e = this.entries.get(chainId);
    if (!e) throw new JsonRpcError(4901, `The provider is disconnected from chain ${chainId}.`);
    return rpcCall(e.config.rpcUrl, method, params);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private entry(chainId: number): Entry {
    const e = this.entries.get(chainId);
    if (!e) throw new Error(`chain ${chainId} is not part of this run (have ${[...this.entries.keys()].join(", ") || "none"})`);
    return e;
  }
}
