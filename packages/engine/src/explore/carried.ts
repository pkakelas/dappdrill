/**
 * What a wallet request carries, read without knowing the contract it is for: the addresses and
 * the whole numbers in it. A router, a bridge or an order book each has its own calldata, but all
 * of them put the recipient, the tokens and the amounts in 32-byte words, and typed data names
 * them outright. That is enough to hold a request against what the page showed.
 */
import { erc20Abi, type PublicClient } from "viem";
import { KNOWN_CHAINS, chainInfo, type WalletRequest } from "@dappdrill/core";
import { publicClients } from "../chain/public.js";
import type { DrillSession, Hex } from "../types.js";

export interface Carried {
  /** Lowercase, in the order they appear. */
  addresses: Hex[];
  amounts: bigint[];
}

const ADDRESS = /^0x[0-9a-f]{40}$/i;
/** Fields of a transaction that are numbers but never an amount of anything. */
const NOT_AN_AMOUNT = /^(gas|gasPrice|gasLimit|maxFeePerGas|maxPriorityFeePerGas|nonce|chainId|type)$/;
const NO_TOKEN = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);

export function carried(req: WalletRequest): Carried {
  const addresses = new Set<Hex>();
  const amounts = new Set<bigint>();
  const word = (hex: string) => {
    const n = BigInt(`0x${hex}`);
    amounts.add(n);
    // Twelve empty bytes and then twenty that aren't: an address, or a number too large to be an amount.
    if (/^0{24}/.test(hex) && n >= 1n << 96n) addresses.add(`0x${hex.slice(24).toLowerCase()}`);
  };
  const walk = (v: unknown, key = ""): void => {
    if (NOT_AN_AMOUNT.test(key)) return;
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) amounts.add(BigInt(v));
    else if (typeof v === "bigint") amounts.add(v);
    else if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (typeof v !== "string") return;
    else if (ADDRESS.test(v)) addresses.add(v.toLowerCase() as Hex);
    else if (/^\d+$/.test(v)) amounts.add(BigInt(v));
    else if (/^0x[0-9a-f]+$/i.test(v)) {
      const hex = v.slice(2);
      if (hex.length <= 64) word(hex.padStart(64, "0"));
      // Calldata is four bytes of selector and then words; bytes in typed data are words alone.
      else words(hex.length % 64 === 8 ? hex.slice(8) : hex, word);
    } else if (v.startsWith("{")) {
      // Typed data comes as a JSON string.
      try {
        walk(JSON.parse(v));
      } catch {
        // Not JSON: a message, with nothing to read.
      }
    }
  };
  if (/Transaction|TypedData|sendCalls/.test(req.method)) walk(req.params);
  return { addresses: [...addresses], amounts: [...amounts] };
}

function words(hex: string, see: (word: string) => void): void {
  for (let i = 0; i + 64 <= hex.length; i += 64) {
    const w = hex.slice(i, i + 64);
    see(w);
    // A call inside a call (a multicall, a batch, a router's inner swap) follows its length, and
    // its own words begin after four more bytes of selector.
    const length = /^0{56}/.test(w) ? parseInt(w.slice(56), 16) : 0;
    const from = i + 64;
    if (length > 4 && length % 32 === 4 && from + length * 2 <= hex.length) words(hex.slice(from + 8, from + length * 2), see);
  }
}

/** A token, and where we learned what it is. */
export interface NamedToken {
  /** Undefined for a chain's own coin. */
  address?: Hex;
  symbol: string;
  decimals: number;
  chainId: number;
  /** Read on a chain of this run. False when it came from a public RPC of a chain the run doesn't have. */
  confirmed: boolean;
}

/**
 * The tokens `wanted` (a symbol or an address) may be: among the addresses the requests carry and
 * the tokens the app read for the wallet, on the chains of this run, and failing that on the
 * other well-known chains, where the far side of a bridge is. `others` are tokens the requests
 * name that aren't it. `chainId` is the chain the requests were sent on.
 */
export async function tokensNamed(session: DrillSession, wanted: string, chainId: number, inRequests: Hex[]): Promise<{ named: NamedToken[]; others: NamedToken[] }> {
  const { chains, wallet } = session;
  const own = chains.configs().map((c) => c.id);
  const want = wanted.toLowerCase();
  const is = (t: NamedToken) => (ADDRESS.test(want) ? t.address === want : t.symbol.toLowerCase() === want);
  const candidates = [...new Set(inRequests)].filter((a) => a !== wallet.address().toLowerCase() && !NO_TOKEN.has(a));
  const named: NamedToken[] = [];
  // A chain's own coin has no address to look up, and eighteen decimals everywhere.
  const coin = [chainInfo(chainId), ...KNOWN_CHAINS].find((c) => c?.nativeSymbol.toLowerCase() === want);
  if (coin) named.push({ symbol: coin.nativeSymbol, decimals: 18, chainId: coin.id, confirmed: true });

  const asked = (id: number) => (chains.tokensRead?.(id, wallet.address()) ?? []).map((a) => a.toLowerCase() as Hex);
  const here = (await Promise.all(own.map((id) => read(chains.client(id), id, [...new Set([...candidates, ...asked(id)])], true)))).flat();
  named.push(...here.filter(is));
  let others = here.filter((t) => !is(t) && candidates.includes(t.address!));
  if (!named.length && candidates.length) {
    const there = (await Promise.all(publicClients(own, chainId).map((c) => read(c.client, c.chainId, candidates, false)))).flat();
    named.push(...there.filter(is));
    others = [...others, ...there.filter((t) => !is(t))];
  }
  return { named, others };
}

async function read(client: PublicClient, chainId: number, addresses: Hex[], confirmed: boolean): Promise<NamedToken[]> {
  const tokens = await Promise.all(
    addresses.map(async (address): Promise<NamedToken | undefined> => {
      try {
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
        ]);
        return { address, symbol, decimals, chainId, confirmed };
      } catch {
        // Not a token on this chain, or the chain didn't answer.
        return undefined;
      }
    }),
  );
  return tokens.filter((t) => !!t);
}
