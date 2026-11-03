/**
 * Small JSON-RPC over HTTP client used by the chain controller and the
 * chain detector. Errors carry the JSON-RPC code so callers can forward them
 * to the page or the wallet unchanged.
 */
import { createServer } from "node:net";

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.data !== undefined ? { data: this.data } : {}) };
  }
}

export function isJsonRpcError(e: unknown): e is JsonRpcError {
  return e instanceof JsonRpcError || (typeof e === "object" && e !== null && typeof (e as any).code === "number" && typeof (e as any).message === "string");
}

/** Normalise anything thrown while serving a request into a JSON-RPC error object. */
export function toRpcError(e: unknown): { code: number; message: string; data?: unknown } {
  if (e instanceof JsonRpcError) return e.toJSON();
  if (isJsonRpcError(e)) return { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) };
  return { code: -32603, message: e instanceof Error ? e.message : String(e) };
}

let nextId = 1;

export async function rpcCall(url: string, method: string, params: unknown[] = [], opts: { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new JsonRpcError(-32603, `RPC ${url} answered HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
  if (body.error) throw new JsonRpcError(body.error.code, body.error.message, body.error.data);
  return body.result;
}

const chainIdCache = new Map<string, Promise<number | undefined>>();

/** Resolve the chain id an RPC endpoint serves. Cached per URL for the process lifetime; undefined when it isn't JSON-RPC. */
export function probeChainId(url: string): Promise<number | undefined> {
  let p = chainIdCache.get(url);
  if (!p) {
    p = rpcCall(url, "eth_chainId", [], { timeoutMs: 8_000 })
      .then((r) => (typeof r === "string" && /^0x[0-9a-f]+$/i.test(r) ? Number.parseInt(r, 16) : undefined))
      .catch(() => undefined);
    chainIdCache.set(url, p);
  }
  return p;
}

/** Lets tests pre-seed or reset the probe cache. */
export function setProbedChainId(url: string, chainId: number | undefined): void {
  chainIdCache.set(url, Promise.resolve(chainId));
}

export function hexToNumber(hex: unknown): number {
  if (typeof hex === "number") return hex;
  if (typeof hex !== "string") throw new Error(`expected hex quantity, got ${typeof hex}`);
  return Number.parseInt(hex, 16);
}

export function toHex(n: number | bigint): `0x${string}` {
  return `0x${n.toString(16)}`;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
