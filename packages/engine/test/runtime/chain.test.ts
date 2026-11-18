import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { rpcCall } from "../../src/chain/rpc.js";
import { CHAIN_ID, startBareChain, startFixture, type Fixture } from "./fixture.js";

let fx: Fixture;
let chains: ChainController;

beforeAll(async () => {
  fx = await startFixture();
  chains = startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], {});
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

describe("startChains", () => {
  it("reaches each chain through its own RPC", async () => {
    expect(chains.configs()).toEqual([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }]);
    expect(chains.rpcUrl(CHAIN_ID)).toBe(fx.rpcUrl);
    expect(await chains.request(CHAIN_ID, "eth_chainId", [])).toBe("0x7a69");
    expect(await chains.client(CHAIN_ID).getChainId()).toBe(CHAIN_ID);
  });

  it("takes a mainnet chain like any other", async () => {
    const main = startChains([{ id: 1, rpcUrl: fx.rpcUrl }], {});
    expect(main.has(1)).toBe(true);
    expect(main.rpcUrl(1)).toBe(fx.rpcUrl);
    await main.close();
  });

  it("refuses the same chain twice, and a chain it doesn't have", async () => {
    expect(() => startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }, { id: CHAIN_ID, rpcUrl: fx.rpcUrl }], {})).toThrow();
    await expect(chains.request(4242, "eth_chainId", [])).rejects.toMatchObject({ code: 4901 });
  });
});

describe("addFromApp", () => {
  const OTHER = 4242;

  it("takes on a chain the app offers a matching RPC for, once, and reports it", async () => {
    const other = await startBareChain(OTHER);
    const added: number[] = [];
    const ctl = startChains([], { onAdded: async (c) => void added.push(c.id) });
    try {
      const req = { id: OTHER, name: "Other", rpcUrls: ["wss://ignored.example", other.rpcUrl] };
      const [a, b] = await Promise.all([ctl.addFromApp(req), ctl.addFromApp(req)]);
      expect(a).toEqual({ id: OTHER, name: "Other", rpcUrl: other.rpcUrl, fromApp: true });
      expect(b).toEqual(a);
      expect(added).toEqual([OTHER]);
      expect(ctl.has(OTHER)).toBe(true);
      expect(await ctl.request(OTHER, "eth_chainId", [])).toBe("0x1092");
      expect(ctl.configs().map((c) => c.id)).toEqual([OTHER]);
      expect(ctl.missing()).toEqual([]);
    } finally {
      await ctl.close();
      await other.close();
    }
  }, 60_000);

  it("remembers a chain it can't reach in missing()", async () => {
    const ctl = startChains([], {});
    try {
      await expect(ctl.addFromApp({ id: OTHER, name: "Other", rpcUrls: [fx.rpcUrl] })).rejects.toThrow(`didn't answer as chain ${OTHER}`);
      await expect(ctl.addFromApp({ id: 4343, rpcUrls: [] })).rejects.toThrow(/no RPC URL/);
      expect(ctl.missing()).toEqual([
        { chainId: OTHER, name: "Other", rpcUrl: fx.rpcUrl, reason: `${fx.rpcUrl} didn't answer as chain ${OTHER}` },
        { chainId: 4343, name: undefined, rpcUrl: undefined, reason: "the app gave no RPC URL for it" },
      ]);
      expect(ctl.has(OTHER)).toBe(false);
    } finally {
      await ctl.close();
    }
  });
});

describe("addFromApp with hosts the page called", () => {
  const OTHER = 4545;

  it("finds the RPC among the page's hosts when the app offers none", async () => {
    const other = await startBareChain(OTHER);
    const ctl = startChains([], {});
    try {
      const cfg = await ctl.addFromApp({ id: OTHER, rpcUrls: [], rpcHints: ["ftp://nope.example", fx.rpcUrl, other.rpcUrl] });
      expect(cfg).toMatchObject({ id: OTHER, rpcUrl: other.rpcUrl, fromApp: true });
    } finally {
      await ctl.close();
      await other.close();
    }
  }, 60_000);

  it("reports once when none of the hosts answer for the chain", async () => {
    const reported: number[] = [];
    const ctl = startChains([], { onMissing: async (m) => void reported.push(m.chainId) });
    try {
      const req = { id: OTHER, rpcUrls: [], rpcHints: [fx.rpcUrl] };
      await expect(ctl.addFromApp(req)).rejects.toThrow(`the one host the page called didn't answer as chain ${OTHER}`);
      await expect(ctl.addFromApp(req)).rejects.toThrow();
      expect(reported).toEqual([OTHER]);
      expect(ctl.missing()[0]).toMatchObject({ chainId: OTHER, rpcUrl: undefined });
    } finally {
      await ctl.close();
    }
  });
});

describe("rpcCall", () => {
  async function busyServer(busyTimes: number, status = 429) {
    const { createServer } = await import("node:http");
    let calls = 0;
    const server = createServer((req, res) => {
      calls++;
      req.resume();
      req.on("end", () => {
        if (calls <= busyTimes) {
          res.writeHead(status).end("slow down");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { url, calls: () => calls, close: () => new Promise((r) => server.close(r)) };
  }

  it("retries a rate-limited public RPC before giving up", async () => {
    const busy = await busyServer(2);
    try {
      expect(await rpcCall(busy.url, "eth_chainId", [], { retryDelaysMs: [1, 1, 1] })).toBe("0x1");
      expect(busy.calls()).toBe(3);
    } finally {
      await busy.close();
    }
  });

  it("still fails when the RPC stays busy, and doesn't retry other errors", async () => {
    const busy = await busyServer(10);
    const broken = await busyServer(10, 400);
    try {
      await expect(rpcCall(busy.url, "eth_chainId", [], { retryDelaysMs: [1, 1] })).rejects.toThrow(/HTTP 429/);
      expect(busy.calls()).toBe(3);
      await expect(rpcCall(broken.url, "eth_chainId", [], { retryDelaysMs: [1, 1] })).rejects.toThrow(/HTTP 400/);
      expect(broken.calls()).toBe(1);
    } finally {
      await busy.close();
      await broken.close();
    }
  });
});
