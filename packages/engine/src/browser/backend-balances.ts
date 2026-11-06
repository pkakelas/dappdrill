/**
 * Some apps ask their own server what the wallet holds, and the server asks the real chain. The
 * test wallet holds nothing there, so the page shows 0 next to a fork that has 100 USDC and every
 * action stops at "Insufficient balance". When a response says exactly what the real chain says
 * about this wallet, we put in what the fork says instead. Chains we don't run, and answers that
 * aren't a single balance (quotes, portfolios), pass through untouched.
 */
import type { BrowserContext, Route } from "playwright";
import { encodeFunctionData, erc20Abi, formatUnits, type Hex } from "viem";
import { KNOWN_CHAINS, type ChainConfig } from "@dappdrill/core";
import type { ChainController } from "../types.js";
import { hexToNumber, rpcCall, toHex } from "../chain/rpc.js";

/** A balance answer is a few fields; anything bigger is something else that happens to hold a zero. */
const MAX_BODY = 4_000;
const REAL_FOR_MS = 60_000;
const REAL_TIMEOUT_MS = 8_000;
const ADDRESS = /0x[0-9a-f]{40}(?![0-9a-f])/g;
/** How apps write "the chain's own coin" where a token address goes. */
const NATIVE = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);
/** Names backends use for chains, besides the ones in KNOWN_CHAINS. Short ones ("eth", "op") also name coins, so they are left out. */
const ALIASES: Record<string, number> = { mainnet: 1, arbitrumone: 42161, bsc: 56, bnb: 56, binance: 56, matic: 137, avalanche: 43114, linea: 59144, scroll: 534352, mantle: 5000, blast: 81457, gnosis: 100 };
const CHAIN_NAMES = new Map([...KNOWN_CHAINS.map((c) => [c.name.toLowerCase().replace(/[^a-z0-9]/g, ""), c.id] as const), ...Object.entries(ALIASES)]);
const CHAIN_ID = /(?:chain_?(?:id)?|eip155)["':=\s]+(\d+)/g;
/** Fields that are never the balance, whatever number they hold. */
const NOT_A_BALANCE = /decim|allow|price|usd|fiat|chain|block|time|nonce|count|id$/i;

export interface BalanceAsk {
  holder: Hex;
  /** Undefined for the chain's own coin. */
  token?: Hex;
  /** The chain the request names; undefined when it names none. */
  chainId?: number;
}

/** What a request asks about one of our wallets: one token (or the coin) on at most one chain. Undefined when it reads as anything else. */
export function balanceAsk(url: string, body: string | null, holders: Hex[]): BalanceAsk | undefined {
  const text = `${decoded(url)} ${body ?? ""}`.toLowerCase();
  const holder = holders.find((h) => text.includes(h.toLowerCase()));
  if (!holder) return undefined;
  const others = [...new Set(text.match(ADDRESS))].filter((a) => !holders.some((h) => h.toLowerCase() === a) && !NATIVE.has(a));
  // Two tokens is a quote or a swap, not a balance.
  if (others.length > 1) return undefined;
  const words = text.split(/[^a-z0-9]+/);
  const named = new Set([...words.map((w) => CHAIN_NAMES.get(w)), ...[...text.matchAll(CHAIN_ID)].map((m) => Number(m[1]))].filter((id) => id !== undefined));
  if (named.size > 1) return undefined;
  return { holder, token: others[0] as Hex | undefined, chainId: [...named][0] };
}

/**
 * The answer with the real chain's balance replaced by the fork's, or undefined when the answer
 * doesn't hold it. Whole digits in a string are the smallest unit, as is hex; a decimal point or
 * a JSON number is whole tokens. Unless the URL says balance, only fields named so are touched.
 */
export function withBalance(answer: unknown, real: bigint, fork: bigint, decimals: number, urlSaysBalance: boolean): unknown | undefined {
  let changed = false;
  const swap = (key: string, value: unknown): unknown => {
    if (NOT_A_BALANCE.test(key) || !(urlSaysBalance || /balanc|wei/i.test(key))) return value;
    const units = formatUnits(real, decimals);
    const to = (v: unknown) => ((changed = true), v);
    if (typeof value === "number") return value === Number(units) ? to(Number(formatUnits(fork, decimals))) : value;
    if (typeof value !== "string") return value;
    if (/^\d+$/.test(value)) return BigInt(value) === real ? to(fork.toString()) : value;
    if (/^0x[0-9a-f]+$/i.test(value) && value.length <= 66) return BigInt(value) === real ? to(toHex(fork)) : value;
    if (/^\d+\.\d+$/.test(value)) return Number(value) === Number(units) ? to(formatUnits(fork, decimals)) : value;
    return value;
  };
  const walk = (key: string, node: unknown): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(key, n));
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(k, v)]));
    return swap(key, node);
  };
  const out = walk("", answer);
  return changed ? out : undefined;
}

export interface BackendBalancesOptions {
  chains: ChainController;
  holders: Hex[];
  /** Called the first time an endpoint is answered from the fork. */
  onAnswered: (endpoint: string) => void;
}

export async function installBackendBalances(context: BrowserContext, opts: BackendBalancesOptions): Promise<void> {
  const { chains } = opts;
  const told = new Set<string>();
  const decimals = new Map<string, Promise<number>>();
  const real = new Map<string, { at: number; value: Promise<bigint | undefined> }>();
  const forks = () => chains.configs().filter((c) => chains.mode(c.id) === "fork");

  /** What the wallet holds on the fork, and on the real chain the fork was copied from. */
  const balances = async (chain: ChainConfig, ask: BalanceAsk): Promise<{ real: bigint; fork: bigint; decimals: number } | undefined> => {
    const call = (data: Hex) => [{ to: ask.token, data }, "latest"];
    const [method, params] = ask.token ? ["eth_call", call(encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [ask.holder] }))] : ["eth_getBalance", [ask.holder, "latest"]];
    const amount = (hex: unknown) => (typeof hex === "string" && hex.length > 2 ? BigInt(hex) : undefined);
    const key = `${chain.id}:${ask.token}:${ask.holder}`;
    // The real chain is somebody's public RPC: ask it once a minute at most, and don't wait long.
    if (!real.has(key) || Date.now() - real.get(key)!.at > REAL_FOR_MS) {
      real.set(key, { at: Date.now(), value: rpcCall(chain.rpcUrl, method, params, { timeoutMs: REAL_TIMEOUT_MS, retryDelaysMs: [] }).then(amount, () => undefined) });
    }
    if (ask.token && !decimals.has(key)) decimals.set(key, chains.request(chain.id, "eth_call", call(encodeFunctionData({ abi: erc20Abi, functionName: "decimals" }))).then(hexToNumber));
    const [onReal, onFork, places] = await Promise.all([real.get(key)!.value, chains.request(chain.id, method, params).then(amount), ask.token ? decimals.get(key)! : 18]);
    return onReal === undefined || onFork === undefined || !Number.isInteger(places) ? undefined : { real: onReal, fork: onFork, decimals: places };
  };

  const handle = async (route: Route): Promise<void> => {
    const request = route.request();
    const ask = /^(fetch|xhr)$/.test(request.resourceType()) ? balanceAsk(request.url(), request.postData(), opts.holders) : undefined;
    const running = forks();
    const chain = ask?.chainId === undefined ? (running.length === 1 ? running[0] : undefined) : running.find((c) => c.id === ask.chainId);
    if (!ask || !chain || /"jsonrpc"\s*:/.test(request.postData() ?? "")) return route.fallback();

    const response = await route.fetch();
    const text = await response.text();
    const pass = () => route.fulfill({ response, body: text });
    if (!response.ok() || text.length > MAX_BODY || !/json/i.test(response.headers()["content-type"] ?? "")) return pass();
    try {
      const held = await balances(chain, ask);
      const path = new URL(request.url()).pathname;
      const body = held && held.real !== held.fork ? withBalance(JSON.parse(text), held.real, held.fork, held.decimals, /balanc/i.test(path)) : undefined;
      if (body === undefined) return pass();
      const endpoint = new URL(request.url()).host + path;
      if (!told.has(endpoint)) opts.onAnswered(endpoint);
      told.add(endpoint);
      return route.fulfill({ response, body: JSON.stringify(body) });
    } catch {
      // Not JSON, or not a token on this chain.
      return pass();
    }
  };

  await context.route("**/*", handle);
}

function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
