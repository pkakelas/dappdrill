import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, multicall3Abi, parseAbi } from "viem";
import { balanceReads } from "../../src/chain/balance-reads.js";
import { fixedRead, relay, upstreamCandidates } from "../../src/chain/upstream.js";

describe("upstreamCandidates", () => {
  it("puts the operator's RPC before our default and keeps the known ones as fallbacks", () => {
    const list = upstreamCandidates({ id: 42161, rpcUrl: "https://arbitrum-one-rpc.publicnode.com" }, { DAPPDRILL_RPC_42161: "https://mine.example, https://second.example" });
    expect(list.slice(0, 3)).toEqual(["https://mine.example", "https://second.example", "https://arbitrum-one-rpc.publicnode.com"]);
    expect(list).toContain("https://arb1.arbitrum.io/rpc");
    expect(new Set(list).size).toBe(list.length);
  });

  it("keeps an RPC somebody chose first", () => {
    expect(upstreamCandidates({ id: 42161, rpcUrl: "https://app-own.example" }, { DAPPDRILL_RPC_42161: "https://mine.example" })[0]).toBe("https://app-own.example");
    expect(upstreamCandidates({ id: 987654321, rpcUrl: "https://custom.example" }, {})).toEqual(["https://custom.example"]);
  });
});

describe("balanceReads", () => {
  const holder = "0x00000000000000000000000000000000000000aa";
  const usdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
  const balanceOf = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] });

  it("sees a plain balanceOf", () => {
    expect(balanceReads("eth_call", [{ to: usdc.toUpperCase().replace("0X", "0x"), data: balanceOf }, "latest"])).toEqual([{ token: usdc, holder }]);
    expect(balanceReads("eth_call", [{ to: usdc, input: balanceOf }])).toHaveLength(1);
  });

  it("sees them inside multicall batches", () => {
    const other = encodeFunctionData({ abi: erc20Abi, functionName: "decimals" });
    const aggregate3 = encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [[{ target: usdc, allowFailure: true, callData: other }, { target: usdc, allowFailure: true, callData: balanceOf }]] });
    const tryAggregate = encodeFunctionData({ abi: parseAbi(["struct Call { address target; bytes callData; }", "function tryAggregate(bool requireSuccess, Call[] calls)"]), functionName: "tryAggregate", args: [false, [{ target: usdc, callData: balanceOf }]] });
    for (const data of [aggregate3, tryAggregate]) expect(balanceReads("eth_call", [{ to: "0xca11bde05977b3631167028862be2a173976ca11", data }])).toEqual([{ token: usdc, holder }]);
  });

  it("ignores everything else", () => {
    expect(balanceReads("eth_getBalance", [holder, "latest"])).toEqual([]);
    expect(balanceReads("eth_call", [{ to: usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "totalSupply" }) }])).toEqual([]);
    expect(balanceReads("eth_call", [{ to: usdc, data: "0x70a08231deadbeef" }])).toEqual([]);
    expect(balanceReads("eth_call", [])).toEqual([]);
  });
});

describe("relay", () => {
  const servers: Server[] = [];
  afterAll(() => servers.forEach((s) => s.close()));

  /** A JSON-RPC server that gives each of `answers` in turn, then the last one for ever. */
  const rpc = async (...answers: object[]): Promise<{ url: string; asked: () => number }> => {
    let asked = 0;
    const server = createServer((req, res) => {
      req.resume().on("end", () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, ...answers[Math.min(asked++, answers.length - 1)] })));
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked: () => asked };
  };
  const ask = async (url: string) => (await fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [] }) })).json();
  const gone = { error: { code: -32000, message: "historical state 4bdd5b is not available" } };

  it("asks again when a node behind the name hasn't got the state", async () => {
    const flaky = await rpc(gone, { result: "0x1" });
    expect(await ask(await relay([flaky.url]))).toMatchObject({ result: "0x1" });
    expect(flaky.asked()).toBe(2);
  });

  it("moves to the next RPC when one never has it, and stays there", async () => {
    const pruned = await rpc(gone);
    const archive = await rpc({ result: "0x2" });
    const url = await relay([pruned.url, archive.url]);
    expect(await ask(url)).toMatchObject({ result: "0x2" });
    expect(await ask(url)).toMatchObject({ result: "0x2" });
    expect(pruned.asked()).toBe(2);
    expect(archive.asked()).toBe(2);
  });

  it("passes on an error that is about the call itself", async () => {
    const reverting = await rpc({ error: { code: 3, message: "execution reverted: ERC20: insufficient allowance" } });
    expect(await ask(await relay([reverting.url]))).toMatchObject({ error: { code: 3 } });
    expect(reverting.asked()).toBe(1);
  });

  it("asks once for a read of a named block, whoever asks and under whatever id", async () => {
    const node = await rpc({ result: "0x7" });
    const url = await relay([node.url]);
    const read = (id: number, block: string) => fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method: "eth_getStorageAt", params: ["0xa", "0x0", block] }) }).then((r) => r.json());
    expect(await Promise.all([read(4, "0x10"), read(5, "0x10")])).toEqual([{ jsonrpc: "2.0", id: 4, result: "0x7" }, { jsonrpc: "2.0", id: 5, result: "0x7" }]);
    expect(await read(6, "0x10")).toMatchObject({ id: 6, result: "0x7" });
    expect(node.asked()).toBe(1);
    await read(7, "0x11");
    await read(8, "latest");
    await read(9, "latest");
    expect(node.asked()).toBe(4);
  });

  it("doesn't remember an answer that was missing", async () => {
    const flaky = await rpc(gone, gone, gone, gone, gone, gone, { result: "0x1" });
    const url = await relay([flaky.url]);
    const read = () => fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: ["0xa", "0x10"] }) }).then((r) => r.json());
    expect(await read()).toMatchObject({ error: { message: gone.error.message } });
    expect(await read()).toMatchObject({ result: "0x1" });
  }, 15_000);

  it("knows which reads can't change", () => {
    const body = (method: string, params: unknown[]) => JSON.stringify({ jsonrpc: "2.0", id: 3, method, params });
    expect(fixedRead(body("eth_getBalance", ["0xa", "0x10"]))).toEqual({ key: 'eth_getBalance ["0xa","0x10"]', id: 3 });
    expect(fixedRead(body("eth_chainId", []))).toBeDefined();
    expect(fixedRead(body("eth_getBalance", ["0xa", "latest"]))).toBeUndefined();
    expect(fixedRead(body("eth_getBalance", ["0xa"]))).toBeUndefined();
    expect(fixedRead(body("eth_blockNumber", []))).toBeUndefined();
    expect(fixedRead(body("eth_sendRawTransaction", ["0x00"]))).toBeUndefined();
    expect(fixedRead(JSON.stringify([{ id: 1, method: "eth_chainId" }]))).toBeUndefined();
    expect(fixedRead("not json")).toBeUndefined();
  });

  it("gives the last answer when no RPC has it", async () => {
    const pruned = await rpc(gone);
    expect(await ask(await relay([pruned.url]))).toMatchObject({ error: { message: gone.error.message } });
  }, 15_000);
});
