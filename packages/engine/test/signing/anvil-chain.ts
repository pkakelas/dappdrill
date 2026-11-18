/**
 * A ChainController over an Anvil process the test starts itself on a free port: an empty local
 * chain, used as it is.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createPublicClient, http, toHex, type Hex, type PublicClient } from "viem";
import type { ChainConfig } from "@dappdrill/core";
import { freePort, rpcCall } from "../../src/chain/rpc.js";
import type { ChainController } from "../../src/types.js";

export class AnvilChain implements ChainController {
  private constructor(
    readonly chainId: number,
    private readonly url: string,
    private readonly proc: ChildProcess,
    private readonly viem: PublicClient,
  ) {}

  /** Starts anvil on a free port and waits for it. */
  static async start(opts: { chainId: number }): Promise<AnvilChain> {
    const port = await freePort();
    const proc = spawn("anvil", ["--port", String(port), "--chain-id", String(opts.chainId), "--silent"], { stdio: ["ignore", "ignore", "pipe"] });
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
    return new AnvilChain(opts.chainId, url, proc, viem);
  }

  configs(): ChainConfig[] {
    return [{ id: this.chainId, rpcUrl: this.url }];
  }
  has(chainId: number) { return chainId === this.chainId; }
  rpcUrl() { return this.url; }
  client() { return this.viem; }
  request(_chainId: number, method: string, params: unknown[]): Promise<unknown> {
    return rpcCall(this.url, method, params);
  }
  /** Anvil's own way to set what an address holds, for a test that needs an empty wallet. */
  async setBalance(address: Hex, wei: bigint) { await this.request(this.chainId, "anvil_setBalance", [address, toHex(wei)]); }
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
