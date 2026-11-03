/**
 * Small HTTP helper for the explorer / registry / blocklist lookups: timeouts,
 * a bounded number of in-flight requests, and a cache (memory + optional disk
 * directory with a TTL) so repeated reviews stay gentle on public APIs.
 *
 * Lookups resolve to `null` for a definite "no data" (e.g. 404) and to
 * `undefined` when the lookup itself failed (timeout, 5xx, bad JSON).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface HttpOptions {
  fetch?: typeof fetch;
  cacheDir?: string;
  maxInFlight?: number;
}

export interface GetOptions {
  timeoutMs?: number;
  /** Cache lifetime. Infinity for immutable data (ABIs, creation blocks). Default: 6h. */
  ttlMs?: number;
  headers?: Record<string, string>;
  /** HTTP statuses that mean "no data" (cached as null). Default: [404]. */
  missingStatuses?: number[];
}

interface Entry<T> {
  at: number;
  body: T | null;
}

const DEFAULT_TTL = 6 * 60 * 60 * 1000;

export class Http {
  private readonly fetchFn: typeof fetch;
  private readonly cacheDir?: string;
  private readonly memory = new Map<string, Promise<Entry<unknown> | undefined>>();
  private readonly limit: number;
  private inFlight = 0;
  private readonly queue: (() => void)[] = [];

  constructor(opts: HttpOptions = {}) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.cacheDir = opts.cacheDir;
    this.limit = opts.maxInFlight ?? 6;
  }

  json<T>(url: string, opts: GetOptions = {}): Promise<T | null | undefined> {
    return this.remember<T>(`GET ${url}`, opts.ttlMs, () => this.fetchBody(url, opts, (res) => res.json() as Promise<T>));
  }

  text(url: string, opts: GetOptions = {}): Promise<string | null | undefined> {
    return this.remember<string>(`GET ${url}`, opts.ttlMs, () => this.fetchBody(url, opts, (res) => res.text()));
  }

  /**
   * Cache any computation under `key`. `compute` returns null for "definitely
   * nothing" (cached) or undefined for "couldn't find out" (not cached; a
   * stale cached value is returned instead when there is one).
   */
  async remember<T>(key: string, ttlMs: number | undefined, compute: () => Promise<T | null | undefined>): Promise<T | null | undefined> {
    const ttl = ttlMs ?? DEFAULT_TTL;
    const id = createHash("sha1").update(key).digest("hex");
    const fresh = (e: Entry<unknown> | undefined): e is Entry<T> => !!e && Date.now() - e.at < ttl;

    const inMemory = await this.memory.get(id);
    if (fresh(inMemory)) return inMemory.body;
    const onDisk = await this.readDisk<T>(id);
    if (fresh(onDisk)) {
      this.memory.set(id, Promise.resolve(onDisk));
      return onDisk.body;
    }

    const pending = compute().then(async (body) => {
      if (body === undefined) return undefined;
      const entry: Entry<T> = { at: Date.now(), body };
      await this.writeDisk(id, entry);
      return entry;
    }, () => undefined);
    this.memory.set(id, pending);
    const entry = await pending;
    if (entry) return entry.body as T | null;
    this.memory.delete(id);
    return (onDisk as Entry<T> | undefined)?.body;
  }

  private async fetchBody<T>(url: string, opts: GetOptions, parse: (res: Response) => Promise<T>): Promise<T | null | undefined> {
    await this.acquire();
    try {
      const res = await this.fetchFn(url, {
        headers: { accept: "application/json, text/plain;q=0.8", ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
      if ((opts.missingStatuses ?? [404]).includes(res.status)) return null;
      if (!res.ok) return undefined;
      return await parse(res);
    } catch {
      return undefined;
    } finally {
      this.release();
    }
  }

  private async readDisk<T>(id: string): Promise<Entry<T> | undefined> {
    if (!this.cacheDir) return undefined;
    try {
      return JSON.parse(await readFile(join(this.cacheDir, `${id}.json`), "utf8")) as Entry<T>;
    } catch {
      return undefined;
    }
  }

  private async writeDisk(id: string, entry: Entry<unknown>): Promise<void> {
    if (!this.cacheDir) return;
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(join(this.cacheDir, `${id}.json`), JSON.stringify(entry, bigintToString));
    } catch {
      // Caching is best effort.
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.limit) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => { this.inFlight++; resolve(); }));
  }

  private release(): void {
    this.inFlight--;
    this.queue.shift()?.();
  }
}

function bigintToString(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Resolve to `fallback` when `p` takes longer than `ms` or rejects. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
