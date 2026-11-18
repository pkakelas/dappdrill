import { EventEmitter } from "node:events";
import type { BrowserContext, Request } from "playwright";
import { describe, expect, it } from "vitest";
import type { RpcLogEntry } from "@dappdrill/core";
import { recordRpc, rpcMethods } from "../../src/browser/rpc-log.js";
import type { ChainController } from "../../src/types.js";

describe("rpcMethods", () => {
  it("reads the methods of a single call and of a batch", () => {
    expect(rpcMethods('{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')).toEqual(["eth_chainId"]);
    expect(rpcMethods('[{"jsonrpc":"2.0","id":1,"method":"eth_call"},{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber"}]')).toEqual(["eth_call", "eth_blockNumber"]);
  });

  it("finds none in what isn't JSON-RPC", () => {
    expect(rpcMethods(null)).toEqual([]);
    expect(rpcMethods('{"query":"{ markets { id } }"}')).toEqual([]);
    expect(rpcMethods('"jsonrpc" but not json')).toEqual([]);
  });
});

describe("recordRpc", () => {
  const post = (url: string, body: string, failure?: string) =>
    ({ url: () => url, method: () => "POST", postData: () => body, failure: () => (failure ? { errorText: failure } : null) }) as unknown as Request;
  const chains = { configs: () => [{ id: 8453, rpcUrl: "https://rpc.example.com" }] } as unknown as ChainController;

  it("logs each call the page made, with the chain when the endpoint is one of ours", () => {
    const context = new EventEmitter();
    const log: RpcLogEntry[] = [];
    recordRpc(context as unknown as BrowserContext, chains, (e) => log.push(e));
    const ours = post("https://rpc.example.com/", '[{"jsonrpc":"2.0","id":1,"method":"eth_call"},{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber"}]');
    const theirs = post("https://node.other.io/v1", '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}', "net::ERR_FAILED");
    const api = post("https://api.example.com/graphql", '{"query":"{ me }"}');
    for (const r of [ours, theirs, api]) context.emit("request", r);
    context.emit("requestfinished", ours);
    context.emit("requestfailed", theirs);
    context.emit("requestfinished", api);
    expect(log.map((e) => [e.chainId, e.method, e.via, e.error])).toEqual([
      [8453, "eth_call", "page", undefined],
      [8453, "eth_blockNumber", "page", undefined],
      [undefined, "eth_chainId", "page", "net::ERR_FAILED"],
    ]);
  });
});
