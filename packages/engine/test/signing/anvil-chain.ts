/**
 * A ChainController over an Anvil process the test starts itself, on a free
 * port, forking a public RPC at a pinned block. Used by the fork integration
 * tests only (DAPPDRILL_FORK_TESTS=1).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createPublicClient, http, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { ChainConfig } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";

export const MAINNET_RPC = process.env.DAPPDRILL_MAINNET_RPC ?? "https://ethereum-rpc.publicnode.com";

/**
 * The block to fork at. Public RPCs prune state older than a few thousand
 * blocks, so a hard-coded pin stops working within a day; default to a block
 * just behind the head, override with DAPPDRILL_FORK_BLOCK for a true pin.
 */
export async function pinnedBlock(upstream: string): Promise<bigint> {
  if (process.env.DAPPDRILL_FORK_BLOCK) return BigInt(process.env.DAPPDRILL_FORK_BLOCK);
  const head = await createPublicClient({ transport: http(upstream, { timeout: 20_000 }) }).getBlockNumber();
  return head - 64n;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

export class AnvilChain implements ChainController {
  private constructor(
    readonly chainId: number,
    readonly port: number,
    readonly upstream: string,
    readonly forkBlock: bigint,
    private readonly proc: ChildProcess,
    private readonly viem: PublicClient,
  ) {}

  /**
   * Starts anvil on a free port and waits for it: a fork of `upstream` at
   * `forkBlock` when given, otherwise a fresh empty chain.
   */
  static async start(opts: { chainId: number; upstream?: string; forkBlock?: bigint; bin?: string }): Promise<AnvilChain> {
    const port = await freePort();
    const args = ["--port", String(port), "--chain-id", String(opts.chainId), "--silent"];
    if (opts.upstream) args.push("--fork-url", opts.upstream, "--no-rate-limit");
    if (opts.upstream && opts.forkBlock !== undefined) args.push("--fork-block-number", opts.forkBlock.toString());
    const proc = spawn(opts.bin ?? "anvil", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += String(d); });

    const url = `http://127.0.0.1:${port}`;
    const viem = createPublicClient({ transport: http(url, { timeout: 60_000 }) });
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (proc.exitCode !== null) throw new Error(`anvil exited: ${stderr}`);
      try {
        await viem.getBlockNumber();
        break;
      } catch {
        if (Date.now() > deadline) { proc.kill("SIGKILL"); throw new Error(`anvil did not come up on ${url}: ${stderr}`); }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return new AnvilChain(opts.chainId, port, opts.upstream ?? url, opts.forkBlock ?? 0n, proc, viem);
  }

  /** Wraps an Anvil somebody else is running (e.g. the harbor-vault fixture on :8545). Never kills it. */
  static async attach(opts: { chainId: number; url: string }): Promise<AnvilChain> {
    const viem = createPublicClient({ transport: http(opts.url, { timeout: 60_000 }) });
    const head = await viem.getBlockNumber();
    const port = Number(new URL(opts.url).port || 80);
    const proc = { exitCode: 0, kill: () => true, once: () => undefined } as unknown as ChildProcess;
    return new AnvilChain(opts.chainId, port, opts.url, head, proc, viem);
  }

  configs(): ChainConfig[] {
    return [{ id: this.chainId, rpcUrl: this.upstream, mode: "fork", forkBlock: this.forkBlock.toString() }];
  }
  has(chainId: number) { return chainId === this.chainId; }
  mode(): "fork" | "live" { return "fork"; }
  rpcUrl() { return `http://127.0.0.1:${this.port}`; }
  client() { return this.viem; }

  async request(_chainId: number, method: string, params: unknown[]): Promise<unknown> {
    const res = await fetch(this.rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  async setBalance(chainId: number, address: Hex, wei: bigint) { await this.request(chainId, "anvil_setBalance", [address, toHex(wei)]); }
  async dealErc20(): Promise<void> { throw new Error("not needed by the signing tests"); }
  async setAutomine(chainId: number, on: boolean) { await this.request(chainId, "evm_setAutomine", [on]); }
  async mine(chainId: number) { await this.request(chainId, "evm_mine", []); }
  async snapshot(chainId: number) { return String(await this.request(chainId, "evm_snapshot", [])); }
  async revert(chainId: number, id: string) { await this.request(chainId, "evm_revert", [id]); }
  async impersonate(chainId: number, address: Address) { await this.request(chainId, "anvil_impersonateAccount", [address]); }
  setFaults(): void {}
  async addFromApp(): Promise<never> {
    throw new Error("this test chain can't add chains");
  }
  missing() {
    return [];
  }

  async close(): Promise<void> {
    if (this.proc.exitCode === null) {
      this.proc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { this.proc.kill("SIGKILL"); resolve(); }, 3000);
        this.proc.once("exit", () => { clearTimeout(t); resolve(); });
      });
    }
  }
}
