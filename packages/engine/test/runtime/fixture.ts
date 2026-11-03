/**
 * Shared fixture for the runtime tests: an Anvil instance standing in for the
 * "real" chain the dApp talks to, the test token + vault deployed on it, and a
 * tiny static server for the test dApp. The engine then forks this chain, so
 * writes made during tests never reach it (which the tests check).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { freePort, rpcCall, sleep } from "../../src/chain/rpc.js";
import { stopProcess } from "../../src/chain/anvil.js";
import { TOKEN_ABI, TOKEN_BYTECODE, VAULT_ABI, VAULT_BYTECODE } from "./contracts.js";

/** Anvil's first default account: deploys the contracts and mints tokens. */
export const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
/** Deterministic test accounts A and B. */
export const ACCOUNTS = {
  A: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
  B: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
};
export const CHAIN_ID = 31337;

export interface Fixture {
  rpcUrl: string;
  token: Hex;
  vault: Hex;
  siteUrl: string;
  /** URL of the dApp with the chain config in the query string. */
  pageUrl(bugs?: string[], extra?: Record<string, string>): string;
  anvil: ChildProcess;
  close(): Promise<void>;
}

export async function startFixture(): Promise<Fixture> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn("anvil", ["--port", String(port), "--chain-id", String(CHAIN_ID), "--silent"], { stdio: "ignore" });
  await waitFor(rpcUrl);

  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const pub = createPublicClient({ transport: http(rpcUrl) });
  const wallet = createWalletClient({ account: deployer, transport: http(rpcUrl) });
  const chain = { id: CHAIN_ID, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };

  const tokenHash = await wallet.deployContract({ abi: TOKEN_ABI, bytecode: TOKEN_BYTECODE, chain });
  const token = (await pub.waitForTransactionReceipt({ hash: tokenHash })).contractAddress!;
  const vaultHash = await wallet.deployContract({ abi: VAULT_ABI, bytecode: VAULT_BYTECODE, args: [token], chain });
  const vault = (await pub.waitForTransactionReceipt({ hash: vaultHash })).contractAddress!;

  const accountA = privateKeyToAccount(ACCOUNTS.A).address;
  const accountB = privateKeyToAccount(ACCOUNTS.B).address;
  for (const who of [accountA, accountB]) {
    const h = await wallet.writeContract({ abi: TOKEN_ABI, address: token, functionName: "mint", args: [who, parseUnits("1000", 6)], chain });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  for (const who of [accountA, accountB]) await rpcCall(rpcUrl, "anvil_setBalance", [who, "0x56bc75e2d63100000"]);

  const html = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "dapp", "index.html"), "utf8");
  const server = await serve(html);
  const siteUrl = `http://localhost:${(server.address() as { port: number }).port}`;

  return {
    rpcUrl,
    token,
    vault,
    siteUrl,
    anvil,
    pageUrl: (bugs = [], extra = {}) => {
      const q = new URLSearchParams({ rpc: rpcUrl, token, vault, chain: String(CHAIN_ID), ...extra });
      if (bugs.length) q.set("bug", bugs.join(","));
      return `${siteUrl}/?${q}`;
    },
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await stopProcess(anvil);
    },
  };
}

/** An empty Anvil chain with its own chain id: a chain the app asks the wallet to add. */
export async function startBareChain(chainId: number): Promise<{ rpcUrl: string; close(): Promise<void> }> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn("anvil", ["--port", String(port), "--chain-id", String(chainId), "--silent"], { stdio: "ignore" });
  await waitFor(rpcUrl);
  return { rpcUrl, close: () => stopProcess(anvil) };
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await rpcCall(url, "eth_chainId", [], { timeoutMs: 1000 });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`anvil at ${url} did not start`);
}

function serve(html: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/?"))) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
