import { spawn, type ChildProcess } from "node:child_process";
import { LOCAL_URL, freePort, rpcCall, sleep } from "./rpc.js";

export interface AnvilFork {
  url: string;
  port: number;
  chainId: number;
  forkBlock: bigint;
  process: ChildProcess;
  close(): Promise<void>;
}

/**
 * Spawn `anvil --fork-url` pinned at a block. When no block is given we pin
 * a few blocks behind the tip so the fork doesn't race reorgs, and return the
 * block so replays can reuse it.
 */
export async function startAnvilFork(opts: {
  rpcUrl: string;
  chainId: number;
  forkBlock?: bigint;
  /** Extra anvil flags for odd chains. */
  extraArgs?: string[];
}): Promise<AnvilFork> {
  const forkBlock = opts.forkBlock ?? pinBehindTip(await latestBlock(opts.rpcUrl), opts.rpcUrl);
  const port = await freePort();
  const args = [
    "--fork-url", opts.rpcUrl,
    "--fork-block-number", forkBlock.toString(),
    "--chain-id", String(opts.chainId),
    "--port", String(port),
    "--host", "127.0.0.1",
    "--silent",
    "--retries", "5",
    "--timeout", "45000",
    // Public RPCs rate limit aggressively; keep well under their budgets.
    "--compute-units-per-second", "200",
    "--no-rate-limit",
    ...(opts.extraArgs ?? []),
  ];
  const child = spawn("anvil", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += String(d)));
  child.stdout?.on("data", () => {});
  const url = `http://127.0.0.1:${port}`;

  const exited = new Promise<never>((_, reject) => {
    child.once("exit", (code) => reject(new Error(`anvil exited with code ${code} while forking ${opts.rpcUrl}: ${stderr.trim()}`)));
    child.once("error", (e) => reject(new Error(`could not start anvil (is Foundry on PATH?): ${e.message}`)));
  });

  await Promise.race([waitForRpc(url, opts.chainId, 60_000), exited]);

  return {
    url,
    port,
    chainId: opts.chainId,
    forkBlock,
    process: child,
    close: () => stopProcess(child),
  };
}

/** Public chains: stay a few blocks behind the tip so the fork doesn't race reorgs. Local chains: the tip is what we want. */
function pinBehindTip(latest: bigint, rpcUrl: string): bigint {
  if (LOCAL_URL.test(rpcUrl) || latest < 64n) return latest;
  return latest - 5n;
}

async function latestBlock(rpcUrl: string): Promise<bigint> {
  const r = await rpcCall(rpcUrl, "eth_blockNumber", [], { timeoutMs: 15_000 });
  return BigInt(r as string);
}

async function waitForRpc(url: string, chainId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const got = await rpcCall(url, "eth_chainId", [], { timeoutMs: 2_000 });
      if (Number.parseInt(got as string, 16) === chainId) return;
      lastErr = new Error(`anvil reports chain ${got}, expected ${chainId}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(150);
  }
  throw new Error(`anvil at ${url} did not become ready: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

export function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
