import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget, stalledLine } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession } from "../../src/browser/session.js";
import { urlMatcher } from "../../src/browser/setup.js";
import { rpcFailures } from "../../src/browser/traffic.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "./fixture.js";

describe("urlMatcher", () => {
  it("matches full URLs with * wildcards, ignoring the query unless the pattern has one", () => {
    expect(urlMatcher("https://app.gmx.io/config.json")("https://app.gmx.io/config.json?t=123")).toBe(true);
    expect(urlMatcher("https://app.gmx.io/config.json")("https://app.gmx.io/config.json.bak")).toBe(false);
    expect(urlMatcher("https://*.gmxinfra.io/prices/*")("https://arbitrum-api.gmxinfra.io/prices/tickers")).toBe(true);
    expect(urlMatcher("https://api.x/q?v=1")("https://api.x/q?v=2")).toBe(false);
  });
});

describe("rpcFailures", () => {
  it("counts failed fork reads per chain and names the upstream's cause", () => {
    const at = new Date().toISOString();
    const failures = rpcFailures(
      [
        { chainId: 1, method: "eth_call", via: "page", durationMs: 5, at, error: "-32603 HTTP error 429 with body: Too Many Requests" },
        { chainId: 1, method: "eth_call", via: "page", durationMs: 5, at, error: "-32603 execution reverted" },
        { chainId: 1, method: "eth_blockNumber", via: "page", durationMs: 5, at },
        { chainId: 42161, method: "eth_call", via: "page", durationMs: 5, at, error: "-32603 missing trie node 0xabc" },
        { chainId: 8453, method: "eth_call", via: "page", durationMs: 5, at, error: "23 The operation was aborted due to timeout" },
        { chainId: 10, method: "eth_call", via: "page", durationMs: 5, at, error: "not a chain we run" },
      ],
      [1, 42161, 8453],
    );
    expect(failures).toEqual([
      { chainId: 1, errors: 2, cause: "rate-limited", sample: "-32603 HTTP error 429 with body: Too Many Requests" },
      { chainId: 42161, errors: 1, cause: "pruned", sample: "-32603 missing trie node 0xabc" },
      { chainId: 8453, errors: 1, cause: "timed-out", sample: "23 The operation was aborted due to timeout" },
    ]);
    expect(stalledLine({ chains: [], backends: [], rpc: failures })).toMatch(/rate-limited by the RPC it forks from \(2 failed reads\)/);
  });

  it("puts a chain the wallet couldn't add ahead of everything else", () => {
    const line = stalledLine({ chains: [{ chainId: 4242, name: "Other", rpcUrl: "https://rpc.other", reason: "https://rpc.other didn't answer as chain 4242" }], backends: [], rpc: [] });
    expect(line).toBe(
      "The app needs a chain the test wallet couldn't use, so exploring stopped there. The app needs Other (chain 4242), RPC https://rpc.other, but the test wallet couldn't add it: https://rpc.other didn't answer as chain 4242. Add it to the app's chains in scan settings with an RPC that answers for it.",
    );
  });
});

let fx: Fixture;
let chains: ChainController;
let server: Server;
let port: number;

beforeAll(async () => {
  fx = await startFixture();
  chains = await startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" }], {});
  server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      return res.end(`<!doctype html><title>App</title><script>
        fetch("http://api.localhost:${port}/hang");
        Promise.all([
          fetch("http://flags.localhost:${port}/config.json?t=1").then((r) => r.json()),
          fetch("http://api.localhost:${port}/markets").then((r) => r.status),
        ]).then(([config, status]) => {
          document.title = [localStorage.getItem("forkEnabled"), config.uiVersion, status].join(" ");
        });
      </script>`);
    }
    if (req.url === "/hang") return; // never answers
    if (req.url === "/markets") {
      res.statusCode = 503;
      return res.end("down");
    }
    res.end(JSON.stringify({ uiVersion: "2.1" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  server?.close();
  await chains?.close();
  await fx?.close();
});

describe("test setup and traffic", () => {
  it("seeds storage, answers fixed responses, and reports the backends the page waited on", async () => {
    const url = `http://app.localhost:${port}/`;
    const target = DrillTarget.parse({
      url,
      chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }],
      accounts: ACCOUNTS,
      storage: { forkEnabled: "true" },
      responses: [{ url: `http://flags.localhost:${port}/config.json`, body: '{"uiVersion":"2.0"}' }],
    });
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-setup-"));
    const session = await createSession(target, chains, { artifactsDir, sink: () => {}, video: false, trace: false, frameIntervalMs: 0 });
    try {
      await session.page.goto(url);
      await session.page.waitForFunction(() => document.title !== "App");
      expect(await session.page.title()).toBe("true 2.0 503");
      await session.page.waitForTimeout(200);
      expect(session.traffic.backends(Date.now() + 20_000)).toEqual([{ host: `api.localhost:${port}`, failed: 1, hung: 1, statuses: [503] }]);
    } finally {
      await session.close();
    }
  }, 60_000);
});
