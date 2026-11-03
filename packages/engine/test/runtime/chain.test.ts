import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainController } from "../../src/types.js";
import { InjectedRpcFault, startChains } from "../../src/chain/controller.js";
import { readBalance } from "../../src/chain/deal-erc20.js";
import { rpcCall } from "../../src/chain/rpc.js";
import { ACCOUNTS, CHAIN_ID, startBareChain, startFixture, type Fixture } from "./fixture.js";

let fx: Fixture;
let chains: ChainController;
const A = privateKeyToAccount(ACCOUNTS.A).address;

beforeAll(async () => {
  fx = await startFixture();
  chains = await startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" }], {});
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

describe("startChains (fork)", () => {
  it("records the pinned fork block and serves the forked chain locally", async () => {
    const [cfg] = chains.configs();
    expect(cfg?.forkBlock).toMatch(/^\d+$/);
    expect(chains.rpcUrl(CHAIN_ID)).not.toBe(fx.rpcUrl);
    expect(chains.mode(CHAIN_ID)).toBe("fork");
    expect(await chains.request(CHAIN_ID, "eth_chainId", [])).toBe("0x7a69");
  });

  it("dealErc20 finds the balance slot and writes stay on the fork", async () => {
    const amount = parseUnits("123456", 6);
    await chains.dealErc20(CHAIN_ID, fx.token, A, amount);
    const rpc = (m: string, p: unknown[]) => chains.request(CHAIN_ID, m, p);
    expect(await readBalance(rpc, fx.token, A)).toBe(amount);
    // the "real" chain is untouched
    expect(await readBalance((m, p) => rpcCall(fx.rpcUrl, m, p), fx.token, A)).toBe(parseUnits("1000", 6));
  });

  it("snapshot / revert pins state", async () => {
    const snap = await chains.snapshot(CHAIN_ID);
    await chains.setBalance(CHAIN_ID, A, 1n);
    expect(await chains.request(CHAIN_ID, "eth_getBalance", [A, "latest"])).toBe("0x1");
    await chains.revert(CHAIN_ID, snap);
    expect(await chains.request(CHAIN_ID, "eth_getBalance", [A, "latest"])).not.toBe("0x1");
  });

  it("applies latency and failure faults to request() only", async () => {
    chains.setFaults({ latencyMs: 300 });
    const t = Date.now();
    await chains.request(CHAIN_ID, "eth_blockNumber", []);
    expect(Date.now() - t).toBeGreaterThanOrEqual(280);

    chains.setFaults({ failureRate: 1 });
    await expect(chains.request(CHAIN_ID, "eth_blockNumber", [])).rejects.toBeInstanceOf(InjectedRpcFault);
    await expect(chains.snapshot(CHAIN_ID)).resolves.toBeTypeOf("string");
    chains.setFaults({});
    await expect(chains.request(CHAIN_ID, "eth_blockNumber", [])).resolves.toBeTypeOf("string");
  });

  it("automine off + mine", async () => {
    await chains.setAutomine(CHAIN_ID, false);
    const before = BigInt((await chains.request(CHAIN_ID, "eth_blockNumber", [])) as string);
    await chains.mine(CHAIN_ID);
    const after = BigInt((await chains.request(CHAIN_ID, "eth_blockNumber", [])) as string);
    expect(after).toBe(before + 1n);
    await chains.setAutomine(CHAIN_ID, true);
  });
});

describe("startChains heartbeat", () => {
  it("mines empty blocks on the wall clock, and pauses while automine is off", async () => {
    const beating = await startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" }], { heartbeatMs: 150 });
    try {
      const head = async () => {
        const b = (await beating.request(CHAIN_ID, "eth_getBlockByNumber", ["latest", false])) as { number: string; timestamp: string };
        return { number: Number(b.number), timestamp: Number(b.timestamp) };
      };
      const start = await head();
      await new Promise((r) => setTimeout(r, 700));
      const later = await head();
      expect(later.number).toBeGreaterThan(start.number);
      expect(Math.abs(later.timestamp - Date.now() / 1000)).toBeLessThan(5);

      await beating.setAutomine(CHAIN_ID, false);
      await new Promise((r) => setTimeout(r, 200));
      const paused = await head();
      await new Promise((r) => setTimeout(r, 600));
      expect((await head()).number).toBe(paused.number);
      await beating.setAutomine(CHAIN_ID, true);
    } finally {
      await beating.close();
    }
  });
});

describe("startChains (live)", () => {
  it("refuses mainnet chains unless allowed, and forwards reads otherwise", async () => {
    await expect(startChains([{ id: 1, rpcUrl: fx.rpcUrl, mode: "live" }], {})).rejects.toThrow(/real money/);
    const live = await startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "live" }], {});
    expect(live.rpcUrl(CHAIN_ID)).toBe(fx.rpcUrl);
    expect(await live.request(CHAIN_ID, "eth_chainId", [])).toBe("0x7a69");
    await expect(live.setBalance(CHAIN_ID, A, 1n)).rejects.toThrow(/needs a fork/);
    await live.close();
  });
});

describe("addFromApp", () => {
  const OTHER = 4242;

  it("forks a chain the app offers a matching RPC for, once, and reports it", async () => {
    const other = await startBareChain(OTHER);
    const added: number[] = [];
    const ctl = await startChains([], { onAdded: async (c) => void added.push(c.id) });
    try {
      const req = { id: OTHER, name: "Other", rpcUrls: ["wss://ignored.example", other.rpcUrl] };
      const [a, b] = await Promise.all([ctl.addFromApp(req), ctl.addFromApp(req)]);
      expect(a).toMatchObject({ id: OTHER, name: "Other", rpcUrl: other.rpcUrl, mode: "fork", fromApp: true });
      expect(b.forkBlock).toBe(a.forkBlock);
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

  it("remembers a chain it can't start in missing()", async () => {
    const ctl = await startChains([], {});
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
