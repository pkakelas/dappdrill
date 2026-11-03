/**
 * External ABI / verification sources: Sourcify v2, Etherscan v2 (when a key
 * is set) and the openchain signature database.
 */
import type { Abi, Address, Hex } from "viem";
import type { Http } from "./http.js";

export interface SourceInfo {
  verified: boolean;
  name?: string;
  abi?: Abi;
  via: "sourcify" | "explorer";
  /** Explorer-reported implementation for proxies. */
  implementation?: Address;
}

const FOREVER = Number.POSITIVE_INFINITY;
const DAY = 24 * 60 * 60 * 1000;

/** undefined = lookup failed; { verified: false } = not verified on Sourcify. */
export async function sourcify(http: Http, chainId: number, address: Address): Promise<SourceInfo | undefined> {
  const url = `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=abi,compilation`;
  const body = await http.json<{ abi?: Abi; compilation?: { name?: string }; match?: string }>(url, { ttlMs: DAY });
  if (body === undefined) return undefined;
  if (body === null || !body.match) return { verified: false, via: "sourcify" };
  return { verified: true, name: body.compilation?.name, abi: body.abi, via: "sourcify" };
}

interface EtherscanSource {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  Proxy: string;
  Implementation: string;
}

export async function etherscan(http: Http, chainId: number, address: Address, apiKey: string): Promise<SourceInfo | undefined> {
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
  const body = await http.json<{ status: string; result: EtherscanSource[] | string }>(url, { ttlMs: DAY });
  if (!body || typeof body.result === "string" || !Array.isArray(body.result)) return undefined;
  const r = body.result[0];
  if (!r || !r.SourceCode) return { verified: false, via: "explorer" };
  let abi: Abi | undefined;
  try {
    abi = JSON.parse(r.ABI) as Abi;
  } catch {
    abi = undefined;
  }
  const implementation = r.Proxy === "1" && /^0x[0-9a-fA-F]{40}$/.test(r.Implementation) ? (r.Implementation as Address) : undefined;
  return { verified: true, name: r.ContractName || undefined, abi, via: "explorer", implementation };
}

export async function etherscanCreation(
  http: Http,
  chainId: number,
  address: Address,
  apiKey: string,
): Promise<{ blockNumber?: bigint; timestamp?: number } | null | undefined> {
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${apiKey}`;
  const body = await http.json<{ status: string; result: { blockNumber?: string; timestamp?: string }[] | string }>(url, { ttlMs: FOREVER });
  if (!body) return undefined;
  if (!Array.isArray(body.result)) return body.status === "0" ? null : undefined;
  const r = body.result[0];
  if (!r) return null;
  return {
    blockNumber: r.blockNumber && /^\d+$/.test(r.blockNumber) ? BigInt(r.blockNumber) : undefined,
    timestamp: r.timestamp && /^\d+$/.test(r.timestamp) ? Number(r.timestamp) : undefined,
  };
}

/** Textual signatures for a 4-byte selector, best match first. */
export async function signatureDb(http: Http, selector: Hex): Promise<string[] | undefined> {
  const url = `https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}&filter=true`;
  const body = await http.json<{ ok: boolean; result?: { function?: Record<string, { name: string; filtered: boolean }[] | null> } }>(url, {
    ttlMs: FOREVER,
  });
  if (!body?.ok) return undefined;
  const hits = body.result?.function?.[selector] ?? [];
  return hits.filter((h) => !h.filtered).map((h) => h.name);
}
