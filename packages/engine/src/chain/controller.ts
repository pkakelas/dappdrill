import { createPublicClient, http, type PublicClient } from "viem";
import { MAINNET_CHAIN_IDS, chainInfo, chainName, type ChainConfig, type MissingChain } from "@dappdrill/core";
import type { AddChainRequest, ChainController, Hex } from "../types.js";
import { startAnvilFork, type AnvilFork } from "./anvil.js";
import { dealErc20 as dealErc20Impl } from "./deal-erc20.js";
import { JsonRpcError, probeChainId, rpcCall, sleep, toHex } from "./rpc.js";
import { balanceReads } from "./balance-reads.js";
import { pickUpstream } from "./upstream.js";

export interface StartChainsOptions {
  /** Funded key for live-mode chains. Without it, live chains are read-only. */
  liveKey?: string;
  /** Live mode refuses mainnet chain ids unless this is set. */
  allowMainnetLive?: boolean;
  /**
   * Mine an empty block this often on every fork (while automine is on). A fork
   * otherwise sits on its pinned block, so dApps see a clock minutes behind and
   * wait forever for confirmations.
   */
  heartbeatMs?: number;
  log?: (message: string) => void;
  /** Called once a chain the app asked for is running, before the wallet answers the app (fund it, report it). */
  onAdded?: (config: ChainConfig) => Promise<void>;
  /** Called when a chain the app asked for couldn't be started (the first time per chain). */
  onMissing?: (chain: MissingChain) => Promise<void>;
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
    refuseMainnetLive(c, opts);
  }
  const entries = await Promise.all(configs.map((c) => startEntry(c, opts)));
  return new Controller(entries, opts);
}

function refuseMainnetLive(c: ChainConfig, opts: StartChainsOptions): void {
  if (c.mode === "live" && MAINNET_CHAIN_IDS.has(c.id) && !opts.allowMainnetLive) {
    throw new Error(`${chainName(c.id)} (chain ${c.id}) holds real money; live mode on it needs allowMainnetLive`);
  }
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
  if (info) return { id: info.id, name: info.name, rpcUrl: info.rpcUrl, mode: info.forkable ? "fork" : "live", fromApp: true };
  const offered = req.rpcUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);
  const hints = (req.rpcHints ?? []).filter((u) => /^https?:\/\//i.test(u) && !offered.includes(u)).slice(0, MAX_HINTS);
  const candidates = [...offered, ...hints];
  if (candidates.length === 0) throw new Error("the app gave no RPC URL for it");
  const ids = await Promise.all(candidates.map((url) => probeChainId(url)));
  const url = candidates.find((_, i) => ids[i] === req.id);
  if (url) return { id: req.id, name: req.name, rpcUrl: url, mode: "fork", fromApp: true };
  if (offered.length) throw new Error(`${offered[0]} didn't answer as chain ${req.id}`);
  const tried = hints.length === 1 ? "the one host the page called didn't answer" : `none of the ${hints.length} hosts the page called answered`;
  throw new Error(`the app gave no RPC URL for it, and ${tried} as chain ${req.id}`);
}

async function startEntry(config: ChainConfig, opts: StartChainsOptions): Promise<Entry> {
  if (config.mode === "live") {
    opts.log?.(`chain ${config.id}: live mode via ${config.rpcUrl}${opts.liveKey ? "" : " (no funded key: signs messages, sends no transactions)"}`);
    return { config, mode: "live", url: config.rpcUrl };
  }
  // The RPC the fork reads from has to keep the fork's block for the whole run; see upstream.ts.
  const upstream = await pickUpstream(config, opts.log);
  if (config.forkBlock && !upstream.pinned) opts.log?.(`chain ${config.id}: block ${config.forkBlock} is no longer available upstream; forking near the latest block`);
  const start = (forkBlock?: bigint) => startAnvilFork({ rpcUrl: upstream.rpcUrl, chainId: config.id, forkBlock });
  let fork: AnvilFork;
  try {
    // A public RPC behind a load balancer now and then hasn't got the block yet, or drops a request: once more, near the tip.
    fork = await start(upstream.pinned ? BigInt(config.forkBlock!) : undefined).catch(() => start());
  } catch (err) {
    // Chains that aren't standard EVM nodes can't be forked: test them live, never on mainnet.
    if (MAINNET_CHAIN_IDS.has(config.id)) throw err;
    opts.log?.(`chain ${config.id}: can't fork ${upstream.via} (${(err as Error).message.split("\n")[0]}); falling back to live mode`);
    return startEntry({ ...config, mode: "live", forkBlock: undefined }, opts);
  }
  opts.log?.(`chain ${config.id}: forked ${upstream.via} at block ${fork.forkBlock} on ${fork.url}`);
  return {
    config: { ...config, forkBlock: fork.forkBlock.toString() },
    mode: "fork",
    url: fork.url,
    fork,
  };
}

class Controller implements ChainController {
  /** ERC-20 balances the app or the wallet asked for, as "chain:holder:token". */
  private readonly read = new Set<string>();
  private readonly entries = new Map<number, Entry>();
  private faults = { latencyMs: 0, failureRate: 0 };
  private rng = seeded(0x5eed);
  private closed = false;
  private readonly automineOff = new Set<number>();
  private heartbeat?: NodeJS.Timeout;
  private readonly adding = new Map<number, Promise<ChainConfig>>();
  private readonly missingChains = new Map<number, MissingChain>();

  constructor(entries: Entry[], private readonly opts: StartChainsOptions) {
    for (const e of entries) this.entries.set(e.config.id, e);
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeat || !this.opts.heartbeatMs || ![...this.entries.values()].some((e) => e.mode === "fork")) return;
    this.heartbeat = setInterval(() => void this.beat(), this.opts.heartbeatMs);
    this.heartbeat.unref();
  }

  addFromApp(req: AddChainRequest): Promise<ChainConfig> {
    const running = this.entries.get(req.id);
    if (running) return Promise.resolve({ ...running.config });
    // The app often asks twice in a row (switch fails, add, retry); start the chain once.
    let p = this.adding.get(req.id);
    if (!p) {
      p = this.startFromApp(req).finally(() => this.adding.delete(req.id));
      this.adding.set(req.id, p);
    }
    return p;
  }

  private async startFromApp(req: AddChainRequest): Promise<ChainConfig> {
    let entry: Entry;
    try {
      const config = await configForApp(req);
      refuseMainnetLive(config, this.opts);
      entry = await startEntry(config, this.opts);
      if (this.closed) {
        await entry.fork?.close();
        throw new Error("the run had already ended");
      }
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
    this.entries.set(req.id, entry);
    this.missingChains.delete(req.id);
    this.startHeartbeat();
    try {
      await this.opts.onAdded?.({ ...entry.config });
    } catch (err) {
      this.opts.log?.(`chain ${req.id}: setting up the added chain failed: ${(err as Error).message}`);
    }
    return { ...entry.config };
  }

  missing(): MissingChain[] {
    return [...this.missingChains.values()];
  }

  /** One empty block per fork, stamped with the wall clock. Skipped while a test holds transactions pending. */
  private async beat(): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        .filter((e) => e.mode === "fork" && !this.automineOff.has(e.config.id))
        .map((e) => rpcCall(e.url, "evm_mine", [], { timeoutMs: 5_000, retryDelaysMs: [] }).catch(() => {})),
    );
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
    for (const r of balanceReads(method, params)) this.read.add(`${chainId}:${r.holder}:${r.token}`);
    return rpcCall(e.url, method, params);
  }

  tokensRead(chainId: number, holder: Hex): Hex[] {
    const prefix = `${chainId}:${holder.toLowerCase()}:`;
    return [...this.read].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length) as Hex);
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
    if (on) this.automineOff.delete(chainId);
    else this.automineOff.add(chainId);
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
    if (this.heartbeat) clearInterval(this.heartbeat);
    await Promise.all([...this.entries.values()].map((e) => e.fork?.close()));
  }

  private entry(chainId: number): Entry {
    const e = this.entries.get(chainId);
    if (!e) throw new Error(`chain ${chainId} is not part of this run (have ${[...this.entries.keys()].join(", ") || "none"})`);
    return e;
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
