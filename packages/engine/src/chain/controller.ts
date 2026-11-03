import { createPublicClient, http, type PublicClient } from "viem";
import { MAINNET_CHAIN_IDS, chainName, type ChainConfig } from "@dappdrill/core";
import type { ChainController, Hex } from "../types.js";
import { startAnvilFork, type AnvilFork } from "./anvil.js";
import { dealErc20 as dealErc20Impl } from "./deal-erc20.js";
import { JsonRpcError, rpcCall, sleep, toHex } from "./rpc.js";

export interface StartChainsOptions {
  /** Funded key for live-mode chains. Without it, live chains are read-only. */
  liveKey?: string;
  /** Live mode refuses mainnet chain ids unless this is set. */
  allowMainnetLive?: boolean;
  log?: (message: string) => void;
}

interface Entry {
  config: ChainConfig;
  mode: "fork" | "live";
  url: string;
  fork?: AnvilFork;
  client?: PublicClient;
}

/** Error raised by an injected RPC fault. Looks like a node failure to the page and the wallet. */
export class InjectedRpcFault extends JsonRpcError {
  constructor() {
    super(-32603, "Internal JSON-RPC error.", { code: -32000, message: "DappDrill: injected RPC failure" });
  }
}

/**
 * Start one Anvil fork per fork-mode chain (in parallel) and wrap live chains
 * in a passthrough. Every call made through `request()` sees the configured
 * faults; the control calls used by the engine itself never do.
 */
export async function startChains(configs: ChainConfig[], opts: StartChainsOptions = {}): Promise<ChainController> {
  const ids = new Set<number>();
  for (const c of configs) {
    if (ids.has(c.id)) throw new Error(`chain ${c.id} is configured twice`);
    ids.add(c.id);
    if (c.mode === "live" && MAINNET_CHAIN_IDS.has(c.id) && !opts.allowMainnetLive) {
      throw new Error(`${chainName(c.id)} (chain ${c.id}) holds real money; live mode on it needs allowMainnetLive`);
    }
  }
  const entries = await Promise.all(configs.map((c) => startEntry(c, opts)));
  return new Controller(entries, opts);
}

async function startEntry(config: ChainConfig, opts: StartChainsOptions): Promise<Entry> {
  if (config.mode === "live") {
    opts.log?.(`chain ${config.id}: live mode via ${config.rpcUrl}${opts.liveKey ? "" : " (no live key: read-only)"}`);
    return { config, mode: "live", url: config.rpcUrl };
  }
  let fork: AnvilFork;
  try {
    fork = await startAnvilFork({
      rpcUrl: config.rpcUrl,
      chainId: config.id,
      forkBlock: config.forkBlock ? BigInt(config.forkBlock) : undefined,
    });
  } catch (err) {
    // Chains that aren't standard EVM nodes can't be forked: test them live, never on mainnet.
    if (MAINNET_CHAIN_IDS.has(config.id)) throw err;
    opts.log?.(`chain ${config.id}: can't fork ${config.rpcUrl} (${(err as Error).message.split("\n")[0]}); falling back to live mode`);
    return startEntry({ ...config, mode: "live", forkBlock: undefined }, opts);
  }
  // Public RPCs prune old state. A block pinned by an earlier scan may no longer
  // be readable; fork near the tip instead of failing every call later.
  if (config.forkBlock && !(await readable(fork.url))) {
    opts.log?.(`chain ${config.id}: block ${config.forkBlock} is no longer available upstream; forking near the latest block`);
    await fork.close();
    fork = await startAnvilFork({ rpcUrl: config.rpcUrl, chainId: config.id });
  }
  opts.log?.(`chain ${config.id}: forked ${config.rpcUrl} at block ${fork.forkBlock} on ${fork.url}`);
  return {
    config: { ...config, forkBlock: fork.forkBlock.toString() },
    mode: "fork",
    url: fork.url,
    fork,
  };
}

class Controller implements ChainController {
  private readonly entries = new Map<number, Entry>();
  private faults = { latencyMs: 0, failureRate: 0 };
  private rng = seeded(0x5eed);
  private closed = false;

  constructor(entries: Entry[], private readonly opts: StartChainsOptions) {
    for (const e of entries) this.entries.set(e.config.id, e);
  }

  configs(): ChainConfig[] {
    return [...this.entries.values()].map((e) => ({ ...e.config }));
  }

  has(chainId: number): boolean {
    return this.entries.has(chainId);
  }

  mode(chainId: number): "fork" | "live" {
    return this.entry(chainId).mode;
  }

  rpcUrl(chainId: number): string {
    return this.entry(chainId).url;
  }

  client(chainId: number): PublicClient {
    const e = this.entry(chainId);
    e.client ??= createPublicClient({ transport: http(e.url, { retryCount: 1 }) });
    return e.client;
  }

  async request(chainId: number, method: string, params: unknown[]): Promise<unknown> {
    const e = this.entries.get(chainId);
    if (!e) throw new JsonRpcError(4901, `The provider is disconnected from chain ${chainId}.`);
    if (this.faults.latencyMs > 0) await sleep(this.faults.latencyMs);
    if (this.faults.failureRate > 0 && this.rng() < this.faults.failureRate) throw new InjectedRpcFault();
    return rpcCall(e.url, method, params);
  }

  /** Engine-side control call: never subject to faults, fork only. */
  private control(chainId: number, method: string, params: unknown[] = []): Promise<unknown> {
    const e = this.entry(chainId);
    if (e.mode !== "fork") throw new Error(`${method} needs a fork; chain ${chainId} runs in live mode`);
    return rpcCall(e.url, method, params);
  }

  async setBalance(chainId: number, address: Hex, wei: bigint): Promise<void> {
    await this.control(chainId, "anvil_setBalance", [address, toHex(wei)]);
  }

  async dealErc20(chainId: number, token: Hex, address: Hex, amount: bigint): Promise<void> {
    await dealErc20Impl((m, p) => this.control(chainId, m, p), token, address, amount);
  }

  async setAutomine(chainId: number, on: boolean): Promise<void> {
    await this.control(chainId, "evm_setAutomine", [on]);
  }

  async mine(chainId: number): Promise<void> {
    await this.control(chainId, "anvil_mine", ["0x1"]);
  }

  async snapshot(chainId: number): Promise<string> {
    return (await this.control(chainId, "evm_snapshot")) as string;
  }

  async revert(chainId: number, snapshotId: string): Promise<void> {
    const ok = await this.control(chainId, "evm_revert", [snapshotId]);
    if (ok !== true) throw new Error(`snapshot ${snapshotId} on chain ${chainId} could not be reverted (already used?)`);
  }

  async impersonate(chainId: number, address: Hex): Promise<void> {
    await this.control(chainId, "anvil_impersonateAccount", [address]);
  }

  setFaults(faults: { latencyMs?: number; failureRate?: number }): void {
    this.faults = { latencyMs: faults.latencyMs ?? 0, failureRate: faults.failureRate ?? 0 };
    this.rng = seeded(0x5eed);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.entries.values()].map((e) => e.fork?.close()));
  }

  private entry(chainId: number): Entry {
    const e = this.entries.get(chainId);
    if (!e) throw new Error(`chain ${chainId} is not part of this run (have ${[...this.entries.keys()].join(", ") || "none"})`);
    return e;
  }
}

/** A fork whose upstream pruned the pinned block fails its first state read. */
async function readable(url: string): Promise<boolean> {
  try {
    await rpcCall(url, "eth_getBalance", ["0x000000000000000000000000000000000000dEaD", "latest"], { timeoutMs: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/** mulberry32: deterministic failures make failing-rpc runs reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
