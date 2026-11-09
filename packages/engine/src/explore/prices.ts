/**
 * Market prices to hold a page's price against. Tokens by address come from DefiLlama; tickers
 * from Coinbase (crypto, and metals by their currency code like XAU) and Yahoo Finance (stocks,
 * indices, futures). None is confirmed on the fork, so a check that uses one says where its
 * number came from.
 */
const TIMEOUT_MS = 8_000;
/** Markets close for weekends and holidays; older than this is no reference. */
const STALE_S = 5 * 24 * 3600;
const LLAMA_CHAIN: Record<number, string> = { 1: "ethereum", 10: "optimism", 56: "bsc", 100: "xdai", 137: "polygon", 324: "era", 8453: "base", 42161: "arbitrum", 43114: "avax", 59144: "linea", 534352: "scroll" };
/** Names apps use for what Yahoo lists under another symbol. */
const YAHOO: Record<string, string> = { SPX: "^GSPC", SP500: "^GSPC", "S&P500": "^GSPC", NDX: "^NDX", NAS100: "^NDX", DJI: "^DJI", US30: "^DJI", XAU: "GC=F", GOLD: "GC=F", XAG: "SI=F", SILVER: "SI=F", WTI: "CL=F", OIL: "CL=F", BRENT: "BZ=F" };

export interface ReferencePrice {
  usd: number;
  source: string;
}

/** Every price we can find for the asset. A ticker can name a coin and a stock, so there may be two, the coin first. */
export async function referencePrices(asset: string, chainId: number): Promise<ReferencePrice[]> {
  const name = asset.trim().replace(/^\$/, "");
  if (/^0x[0-9a-f]{40}$/i.test(name)) return [await byAddress(name, chainId)].filter((p) => !!p);
  const ticker = tickerOf(name);
  if (!ticker) return [];
  return (await Promise.all([coinbase(ticker), yahoo(YAHOO[ticker] ?? ticker)])).filter((p) => !!p);
}

/** "ETH-USD", "BTC/USDT" and "$eth" name ETH. Without a separator the letters stay: crvUSD and sUSD are assets of their own. */
export function tickerOf(asset: string): string | undefined {
  const ticker = asset.trim().replace(/^\$/, "").toUpperCase().replace(/[-/ ]USDT?$/, "").replace(/\s+/g, "");
  return /^[A-Z0-9.&^=]{1,12}$/.test(ticker) ? ticker : undefined;
}

async function byAddress(address: string, chainId: number): Promise<ReferencePrice | undefined> {
  const chain = LLAMA_CHAIN[chainId];
  if (!chain) return undefined;
  const key = `${chain}:${address}`;
  const body = (await get(`https://coins.llama.fi/prices/current/${key}`)) as { coins?: Record<string, { price?: number; timestamp?: number }> } | undefined;
  const coin = Object.entries(body?.coins ?? {}).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
  return coin?.price && fresh(coin.timestamp) ? { usd: coin.price, source: "DefiLlama" } : undefined;
}

async function coinbase(ticker: string): Promise<ReferencePrice | undefined> {
  if (!/^[A-Z0-9]+$/.test(ticker)) return undefined;
  const body = (await get(`https://api.coinbase.com/v2/prices/${ticker}-USD/spot`)) as { data?: { amount?: string } } | undefined;
  const usd = Number(body?.data?.amount);
  return usd > 0 ? { usd, source: "Coinbase" } : undefined;
}

async function yahoo(symbol: string): Promise<ReferencePrice | undefined> {
  const body = (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`)) as
    | { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number; currency?: string } }[] } }
    | undefined;
  const meta = body?.chart?.result?.[0]?.meta;
  return meta?.regularMarketPrice && meta.currency === "USD" && fresh(meta.regularMarketTime) ? { usd: meta.regularMarketPrice, source: "Yahoo Finance" } : undefined;
}

const fresh = (at?: number) => at !== undefined && Date.now() / 1000 - at < STALE_S;

async function get(url: string): Promise<unknown> {
  try {
    // Yahoo turns away requests that name no browser.
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}
