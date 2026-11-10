/**
 * Which RPCs a fork reads from, and how.
 *
 * A fork asks its upstream for state at the block it was pinned to, for as long as the run lasts.
 * Many public RPCs keep state for only the last hundred or so blocks, which is half a minute on
 * Arbitrum: a fork of one answers for what it has already read and fails on everything else, and
 * a second fork at the same block can't start at all. Others are several nodes behind one name,
 * of which only some still have the state, so the same read works one moment and not the next.
 *
 * So each RPC we know for the chain is asked a few times for state from half an hour ago, and the
 * fork reads through a relay on this machine that goes to the ones that had it, asks again when an
 * answer is missing and moves on to the next when it stays missing. The relay also remembers what
 * it read at a pinned block, so the tenth fork of a pass costs the RPC almost nothing.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chainInfo, type ChainConfig } from "@dappdrill/core";
import { LOCAL_URL, rpcCall, sleep, toHex } from "./rpc.js";

/** How long a run may need the fork's block: a pass and its proofs. */
const KEEP_S = 30 * 60;
const PROBE_TIMEOUT_MS = 8_000;
/** Asked this many times: a name with several nodes behind it gives a different one each time. */
const PROBES = 3;
const CACHE_MS = 10 * 60_000;
/** Anything less than a clean yes is asked again much sooner: it is as often a rate limit as an RPC that prunes. */
const CACHE_UNSURE_MS = 30_000;
const SOME_ADDRESS = "0x000000000000000000000000000000000000dEaD";

const RELAY_ATTEMPTS = 6;
const RELAY_TIMEOUT_MS = 15_000;
/** Between tries the wait doubles up to this; anvil gives a read 45 seconds before it asks again itself. */
const RELAY_WAIT_MAX_MS = 4_000;
const RELAY_AT_ONCE = 12;
const RELAY_REMEMBERS = 50_000;
/** Errors that say "ask again, or ask someone else", not "the call is wrong". */
const MISSING = /historical state|missing trie node|state .{0,80}not available|header not found|block not found|pruned|rate.?limit|too many requests|limit exceeded|capacity|timed? ?out|temporarily|unavailable/i;

export interface Upstream {
  /** What the fork is started from: the relay, or the chain's own RPC when that is on this machine. */
  rpcUrl: string;
  /** The RPCs behind it, for the log. */
  via: string;
  /** The pinned block can still be read there. False: fork near the tip instead. */
  pinned: boolean;
  /** False when no RPC we tried keeps state long enough, so the fork may stop answering mid-run. */
  keeps: boolean;
}

/** RPCs to try for a chain, best first: the operator's own, the configured one, then the public ones we know. */
export function upstreamCandidates(config: Pick<ChainConfig, "id" | "rpcUrl">, env: NodeJS.ProcessEnv = process.env): string[] {
  const info = chainInfo(config.id);
  const ours = (env[`DAPPDRILL_RPC_${config.id}`] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const known = info ? [info.rpcUrl, ...(info.fallbackRpcs ?? [])] : [];
  // An RPC somebody chose (the app's own endpoint, a custom chain) stays first; our default gives way to the operator's.
  const chosen = known.includes(config.rpcUrl) ? [...ours, config.rpcUrl] : [config.rpcUrl, ...ours];
  return [...new Set([...chosen, ...known])];
}

export async function pickUpstream(config: ChainConfig, log?: (message: string) => void): Promise<Upstream> {
  const candidates = upstreamCandidates(config);
  if (LOCAL_URL.test(config.rpcUrl)) return { rpcUrl: config.rpcUrl, via: host(config.rpcUrl), pinned: !!config.forkBlock, keeps: true };

  // Twice: every RPC having a bad moment at once shouldn't put a whole run on a fork that goes stale.
  let scores = await Promise.all(candidates.map((url) => keepsState(url)));
  if (!scores.some(Boolean)) {
    await sleep(2_000);
    scores = await Promise.all(candidates.map((url) => keepsState(url, true)));
  }
  const keepers = candidates
    .map((url, i) => ({ url, score: scores[i]! }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.url);
  if (!keepers.length) {
    log?.(
      `chain ${config.id}: ${candidates.length === 1 ? "its RPC keeps" : `none of ${candidates.length} RPCs keep`} state for only the latest blocks, so the fork may stop answering after a while. Set an archive RPC for it (DAPPDRILL_RPC_${config.id}, or the chain's RPC in the app's settings).`,
    );
    return { rpcUrl: await relay(candidates), via: candidates.map(host).join(", "), pinned: false, keeps: false };
  }
  const rpcUrl = await relay(keepers);
  const via = keepers.map(host).join(", ");
  if (keepers[0] !== config.rpcUrl) log?.(`chain ${config.id}: ${host(config.rpcUrl)} doesn't keep old state; forking ${via} instead`);
  return { rpcUrl, via, pinned: !!config.forkBlock && (await hasState(rpcUrl, BigInt(config.forkBlock))), keeps: true };
}

const kept = new Map<string, { score: Promise<number>; at: number }>();

/** How many of a few tries found state from half an hour ago at this RPC. All of them is remembered for ten minutes. */
async function keepsState(url: string, fresh = false): Promise<number> {
  if (LOCAL_URL.test(url)) return PROBES;
  const hit = kept.get(url);
  if (hit && ((await hit.score) === PROBES ? Date.now() - hit.at < CACHE_MS : !fresh && Date.now() - hit.at < CACHE_UNSURE_MS)) return hit.score;
  const score = probe(url).catch(() => 0);
  kept.set(url, { score, at: Date.now() });
  return score;
}

async function probe(url: string): Promise<number> {
  const call = (method: string, params: unknown[]) => rpcCall(url, method, params, { timeoutMs: PROBE_TIMEOUT_MS, retryDelaysMs: [1_000] });
  const latest = BigInt((await call("eth_blockNumber", [])) as string);
  const span = latest < 1000n ? latest : 1000n;
  // A chain this young has nothing old to lose.
  if (span < 10n) return PROBES;
  const [now, then] = (await Promise.all([latest, latest - span].map((n) => call("eth_getBlockByNumber", [toHex(n), false])))) as { timestamp: string }[];
  const perBlock = Math.max(0.05, (Number(BigInt(now!.timestamp)) - Number(BigInt(then!.timestamp))) / Number(span));
  const back = BigInt(Math.ceil(KEEP_S / perBlock));
  const block = back >= latest ? 1n : latest - back;
  const tries = await Promise.all(Array.from({ length: PROBES }, () => hasState(url, block)));
  return tries.filter(Boolean).length;
}

async function hasState(url: string, block: bigint): Promise<boolean> {
  return rpcCall(url, "eth_getBalance", [SOME_ADDRESS, toHex(block)], { timeoutMs: PROBE_TIMEOUT_MS, retryDelaysMs: [] }).then(
    () => true,
    () => false,
  );
}

const relays = new Map<string, Promise<string>>();

/**
 * A JSON-RPC endpoint on this machine in front of `urls`. A call goes to the RPC that answered
 * last; when the answer is missing (no state, a rate limit, no answer at all) it is asked again
 * and then the next one is. Reads of a named block are remembered, since every fork of a pass
 * asks for the same ones and a public RPC stops answering when each asks for itself.
 * One per list of RPCs, for the life of the process.
 */
export function relay(urls: string[]): Promise<string> {
  const key = urls.join(" ");
  let started = relays.get(key);
  if (!started) relays.set(key, (started = startRelay(urls)));
  return started;
}

interface Answer {
  ok: boolean;
  status: number;
  text: string;
}

function startRelay(urls: string[]): Promise<string> {
  let first = 0;
  let asking = 0;
  const waiting: (() => void)[] = [];
  const remembered = new Map<string, Promise<Answer>>();

  const ask = async (body: string): Promise<Answer> => {
    // A burst of forks starting together is what trips a public RPC's limit.
    if (asking >= RELAY_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
    else asking++;
    try {
      let answer: Answer = { ok: false, status: 502, text: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "no upstream RPC answered" } }) };
      for (let attempt = 0; attempt < RELAY_ATTEMPTS; attempt++) {
        // The same RPC twice before moving on: a second ask often lands on a node that has it.
        const at = (first + Math.floor(attempt / 2)) % urls.length;
        const got = await forward(urls[at]!, body);
        if (got.text) answer = got;
        if (got.ok) {
          first = at;
          break;
        }
        if (attempt < RELAY_ATTEMPTS - 1) await sleep(Math.min(RELAY_WAIT_MAX_MS, 250 * 2 ** attempt));
      }
      return answer;
    } finally {
      // The place goes straight to whoever waited longest.
      const next = waiting.shift();
      if (next) next();
      else asking--;
    }
  };

  const answerTo = async (body: string): Promise<Answer> => {
    const request = fixedRead(body);
    if (!request) return ask(body);
    let known = remembered.get(request.key);
    if (!known) {
      known = ask(body);
      remembered.set(request.key, known);
      if (remembered.size > RELAY_REMEMBERS) remembered.delete(remembered.keys().next().value!);
      void known.then((a) => !(a.ok && hasResult(a.text)) && remembered.get(request.key) === known && remembered.delete(request.key));
    }
    const answer = await known;
    // The answer was to somebody else's request id.
    return answer.ok ? { ...answer, text: JSON.stringify({ ...(JSON.parse(answer.text) as object), id: request.id }) } : answer;
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const answer = await answerTo(Buffer.concat(chunks).toString());
      res.writeHead(answer.status, { "content-type": "application/json" }).end(answer.text);
    });
  });
  // The relay never keeps the process alive on its own.
  server.unref();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

/** Reads whose answer can't change once they name a block by number or hash. The last number is how many params that takes. */
const FIXED: Record<string, number> = {
  eth_chainId: 0,
  net_version: 0,
  eth_getBlockByHash: 2,
  eth_getBlockByNumber: 2,
  eth_getBalance: 2,
  eth_getCode: 2,
  eth_getTransactionCount: 2,
  eth_getStorageAt: 3,
  eth_getProof: 3,
  eth_call: 2,
};
const MOVING = /"(latest|pending|safe|finalized|earliest)"/;

/** The request as a key, when it is one read of a fixed block. */
export function fixedRead(body: string): { key: string; id: unknown } | undefined {
  try {
    const request = JSON.parse(body) as { id?: unknown; method?: string; params?: unknown[] };
    const needs = typeof request.method === "string" ? FIXED[request.method] : undefined;
    if (needs === undefined || (request.params?.length ?? 0) < needs) return undefined;
    const params = JSON.stringify(request.params ?? []);
    return MOVING.test(params) ? undefined : { key: `${request.method} ${params}`, id: request.id ?? null };
  } catch {
    return undefined;
  }
}

/** A null is "not here yet" as often as "no such block", so it isn't an answer to keep. */
function hasResult(text: string): boolean {
  try {
    return (JSON.parse(text) as { result?: unknown }).result != null;
  } catch {
    return false;
  }
}

async function forward(url: string, body: string): Promise<Answer> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
    const text = await res.text();
    return { ok: res.ok && !missing(text), status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

/** Only error messages are read: a result may hold any words. */
function missing(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } } | { error?: { message?: string } }[];
    return (Array.isArray(parsed) ? parsed : [parsed]).some((r) => MISSING.test(r?.error?.message ?? ""));
  } catch {
    return true;
  }
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
