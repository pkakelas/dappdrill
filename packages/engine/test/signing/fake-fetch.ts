/** A fetch that answers from a route table and 404s everything else. Records every URL it saw. */
export type Routes = Record<string, unknown | ((url: string) => unknown)>;

export function fakeFetch(routes: Routes = {}): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [prefix, answer] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        const body = typeof answer === "function" ? (answer as (u: string) => unknown)(url) : answer;
        if (body === undefined) return new Response("not found", { status: 404 });
        if (body instanceof Response) return body;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

/** Sourcify v2 "verified" answer. */
export function sourcifyVerified(name: string, abi: unknown[] = []) {
  return { abi, compilation: { name }, match: "exact_match" };
}

export const BLOCKLISTS = (opts: { addresses?: string[]; domains?: string[] } = {}) => ({
  "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json": opts.addresses ?? [],
  "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json": opts.domains ?? [],
  "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json": { blacklist: [] },
});
