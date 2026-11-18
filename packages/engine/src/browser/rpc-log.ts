/**
 * Records the JSON-RPC calls the page makes over fetch/XHR, for a run's evidence. Nothing is
 * routed or changed: the page talks to its own nodes.
 */
import type { BrowserContext, Request } from "playwright";
import { nowIso, type RpcLogEntry } from "@dappdrill/core";
import type { ChainController } from "../types.js";

export function recordRpc(context: BrowserContext, chains: ChainController, onLog: (entry: RpcLogEntry) => void): void {
  const started = new WeakMap<Request, number>();
  context.on("request", (r) => {
    if (r.method() === "POST") started.set(r, Date.now());
  });
  const log = (r: Request, error?: string) => {
    const since = started.get(r);
    const methods = since === undefined ? [] : rpcMethods(r.postData());
    if (!methods.length) return;
    const url = r.url();
    const chainId = chains.configs().find((c) => sameEndpoint(c.rpcUrl, url))?.id;
    for (const method of methods) onLog({ chainId, url, method, via: "page", durationMs: Date.now() - since!, error, at: nowIso() });
  };
  context.on("requestfinished", (r) => log(r));
  context.on("requestfailed", (r) => log(r, r.failure()?.errorText ?? "the request failed"));
}

/** The methods of a JSON-RPC body, single or batched; none when it isn't JSON-RPC. */
export function rpcMethods(body: string | null): string[] {
  if (!body || !body.includes('"jsonrpc"')) return [];
  try {
    const json: unknown = JSON.parse(body);
    return (Array.isArray(json) ? json : [json]).flatMap((item) => (typeof (item as { method?: unknown } | null)?.method === "string" ? [(item as { method: string }).method] : []));
  } catch {
    return [];
  }
}

/** Browsers add a trailing slash to bare origins. */
const sameEndpoint = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
