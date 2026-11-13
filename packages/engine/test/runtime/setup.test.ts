import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession } from "../../src/browser/session.js";
import { urlMatcher } from "../../src/browser/setup.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "./fixture.js";

describe("urlMatcher", () => {
  it("matches full URLs with * wildcards, ignoring the query unless the pattern has one", () => {
    expect(urlMatcher("https://app.gmx.io/config.json")("https://app.gmx.io/config.json?t=123")).toBe(true);
    expect(urlMatcher("https://app.gmx.io/config.json")("https://app.gmx.io/config.json.bak")).toBe(false);
    expect(urlMatcher("https://*.gmxinfra.io/prices/*")("https://arbitrum-api.gmxinfra.io/prices/tickers")).toBe(true);
    expect(urlMatcher("https://api.x/q?v=1")("https://api.x/q?v=2")).toBe(false);
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
  it("seeds storage and answers fixed responses", async () => {
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
    } finally {
      await session.close();
    }
  }, 60_000);
});
