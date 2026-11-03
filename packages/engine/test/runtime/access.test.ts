import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession } from "../../src/browser/session.js";
import { detectBotCheck, onAppSite, siteOf } from "../../src/browser/access.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "./fixture.js";

describe("siteOf / onAppSite", () => {
  it("scopes to the registrable domain", () => {
    expect(siteOf("app.aave.com")).toBe("aave.com");
    expect(siteOf("swap.cow.fi")).toBe("cow.fi");
    expect(siteOf("app.example.co.uk")).toBe("example.co.uk");
    expect(siteOf("localhost")).toBe("localhost");
    expect(siteOf("127.0.0.1")).toBe("127.0.0.1");
    expect(onAppSite("https://api.aave.com/data", "https://app.aave.com/")).toBe(true);
    expect(onAppSite("https://aave.com/", "https://app.aave.com/")).toBe(true);
    expect(onAppSite("https://eth-mainnet.g.alchemy.com/v2/x", "https://app.aave.com/")).toBe(false);
    expect(onAppSite("https://notaave.com/", "https://app.aave.com/")).toBe(false);
  });
});

let fx: Fixture;
let chains: ChainController;
let server: Server;
let port: number;
const seen: { host: string; path: string; headers: IncomingHttpHeaders }[] = [];

beforeAll(async () => {
  fx = await startFixture();
  chains = await startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" }], {});
  // One server answers for every *.localhost name; the Host header tells them apart.
  server = createServer((req, res) => {
    seen.push({ host: (req.headers.host ?? "").split(":")[0]!, path: req.url ?? "", headers: req.headers });
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      return res.end(`<!doctype html><title>App</title><script>
        Promise.all([fetch("http://api.myapp.localhost:${port}/data"), fetch("http://tracker.localhost:${port}/pixel")])
          .then(() => document.title = "loaded");
      </script>`);
    }
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
}, 60_000);

afterAll(async () => {
  server?.close();
  await chains?.close();
  await fx?.close();
});

describe("access headers", () => {
  it("sends the owner's header to the app's own site only, and says it's DappDrill", async () => {
    const url = `http://app.myapp.localhost:${port}/`;
    const target = DrillTarget.parse({ url, chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS, headers: { "x-bypass": "s3cret" } });
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-access-"));
    const session = await createSession(target, chains, { artifactsDir, sink: () => {}, video: false, trace: false, frameIntervalMs: 0 });
    try {
      await session.page.goto(url);
      await session.page.waitForFunction(() => document.title === "loaded");
    } finally {
      await session.close();
    }
    const by = (host: string) => seen.filter((s) => s.host === host);
    expect(by("app.myapp.localhost")[0]?.headers["x-bypass"]).toBe("s3cret");
    expect(by("api.myapp.localhost")[0]?.headers["x-bypass"]).toBe("s3cret");
    expect(by("tracker.localhost")).not.toHaveLength(0);
    expect(by("tracker.localhost")[0]?.headers["x-bypass"]).toBeUndefined();
    expect(by("app.myapp.localhost")[0]?.headers["user-agent"]).toContain("DappDrill/1.0 (+https://dappdrill.com/bot)");
  }, 60_000);
});

describe("detectBotCheck", () => {
  it("names the provider of a challenge page and leaves normal pages alone", async () => {
    const url = `http://app.myapp.localhost:${port}/plain`;
    const target = DrillTarget.parse({ url, chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS });
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-botcheck-"));
    const session = await createSession(target, chains, { artifactsDir, sink: () => {}, video: false, trace: false, frameIntervalMs: 0 });
    try {
      await session.page.goto(url);
      expect(await detectBotCheck(session.page)).toBeUndefined();
      await session.page.setContent("<title>Just a moment...</title><p>Checking your browser before accessing app.example.com. Ray ID: 8f2a</p>");
      expect(await detectBotCheck(session.page)).toMatchObject({ provider: "Cloudflare" });
      await session.page.setContent("<title>Vercel Security Checkpoint</title><p>We're verifying your browser</p>");
      expect(await detectBotCheck(session.page)).toMatchObject({ provider: "Vercel" });
      await session.page.setContent("<title>Swap</title><p>Please verify you are human to continue</p>");
      expect(await detectBotCheck(session.page)).toMatchObject({ provider: undefined, reason: "The page text looks like a bot check" });

      // A login widget's invisible hCaptcha (Privy) is not a challenge; a visible checkbox is.
      await session.page.route("https://newassets.hcaptcha.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<p>hcaptcha</p>" }));
      const frame = (style: string, hash: string) =>
        `<title>Trade</title><p>Connect wallet</p><iframe style="${style}" src="https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=${hash}"></iframe>`;
      await session.page.setContent(frame("width:0;height:0;border:0", "checkbox"), { waitUntil: "load" });
      expect(await detectBotCheck(session.page)).toBeUndefined();
      await session.page.setContent(frame("width:300px;height:80px", "checkbox-invisible"), { waitUntil: "load" });
      expect(await detectBotCheck(session.page)).toBeUndefined();
      await session.page.setContent(frame("position:absolute;top:-10000px;width:300px;height:80px", "checkbox"), { waitUntil: "load" });
      expect(await detectBotCheck(session.page)).toBeUndefined();
      await session.page.setContent(frame("width:300px;height:80px", "checkbox"), { waitUntil: "load" });
      expect(await detectBotCheck(session.page)).toMatchObject({ provider: "hCaptcha" });
    } finally {
      await session.close();
    }
  }, 60_000);
});
