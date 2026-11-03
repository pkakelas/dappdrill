/**
 * ERC-7730 clear-signing descriptors from the public registry
 * (github.com/ethereum/clear-signing-erc7730-registry). The registry publishes
 * two index files keyed by `eip155:{chainId}:{address}`; we fetch those once
 * a day and then only the descriptor (plus its `includes`) that applies.
 * Best effort: any failure returns undefined.
 */
import { toFunctionSelector, type Abi, type Address, type Hex } from "viem";
import type { Http } from "./http.js";

const RAW = "https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/master/";
const DAY = 24 * 60 * 60 * 1000;

export interface Erc7730Match {
  intent: string;
  /** Field labels from the descriptor, e.g. ["Amount", "Approve to spender"]. */
  labels: string[];
  owner?: string;
  contractName?: string;
  abi?: Abi;
  descriptor: string;
}

interface Descriptor {
  includes?: string;
  context?: { contract?: { abi?: unknown }; eip712?: unknown };
  metadata?: { owner?: string; contractName?: string };
  display?: { formats?: Record<string, { intent?: unknown; fields?: { label?: string; fields?: { label?: string }[] }[] }> };
}

export async function erc7730Calldata(http: Http, chainId: number, address: Address, selector: Hex): Promise<Erc7730Match | undefined> {
  const index = await http.json<Record<string, string>>(`${RAW}index.calldata.json`, { ttlMs: DAY, timeoutMs: 12_000 });
  const path = index?.[`eip155:${chainId}:${address.toLowerCase()}`];
  if (!path) return undefined;
  const descriptor = await loadDescriptor(http, path);
  if (!descriptor?.display?.formats) return undefined;
  for (const [key, format] of Object.entries(descriptor.display.formats)) {
    const keySelector = key.startsWith("0x") ? key.toLowerCase() : safeSelector(key);
    if (keySelector === selector.toLowerCase()) return toMatch(descriptor, format, path);
  }
  return undefined;
}

export async function erc7730TypedData(http: Http, chainId: number, verifyingContract: Address, primaryType: string): Promise<Erc7730Match | undefined> {
  const index = await http.json<Record<string, Record<string, { path: string }[]>>>(`${RAW}index.eip712.json`, { ttlMs: DAY, timeoutMs: 12_000 });
  const path = index?.[`eip155:${chainId}:${verifyingContract.toLowerCase()}`]?.[primaryType]?.[0]?.path;
  if (!path) return undefined;
  const descriptor = await loadDescriptor(http, path);
  if (!descriptor?.display?.formats) return undefined;
  for (const [key, format] of Object.entries(descriptor.display.formats)) {
    if (key === primaryType || key.startsWith(`${primaryType}(`)) return toMatch(descriptor, format, path);
  }
  return undefined;
}

async function loadDescriptor(http: Http, path: string): Promise<Descriptor | undefined> {
  const own = await http.json<Descriptor>(`${RAW}${path}`, { ttlMs: DAY });
  if (!own) return undefined;
  if (!own.includes) return own;
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const base = await http.json<Descriptor>(`${RAW}${dir}${own.includes}`, { ttlMs: DAY });
  if (!base) return own;
  return {
    ...base,
    ...own,
    metadata: { ...base.metadata, ...own.metadata },
    display: { formats: { ...base.display?.formats, ...own.display?.formats } },
  };
}

function toMatch(d: Descriptor, format: NonNullable<NonNullable<Descriptor["display"]>["formats"]>[string], descriptor: string): Erc7730Match | undefined {
  const intent = typeof format.intent === "string" ? format.intent : format.intent && typeof format.intent === "object" ? Object.values(format.intent as Record<string, string>)[0] : undefined;
  if (!intent) return undefined;
  const labels: string[] = [];
  for (const f of format.fields ?? []) {
    if (f.label) labels.push(f.label);
    for (const g of f.fields ?? []) if (g.label) labels.push(g.label);
  }
  const abi = Array.isArray(d.context?.contract?.abi) ? (d.context!.contract!.abi as Abi) : undefined;
  return { intent, labels, owner: d.metadata?.owner, contractName: d.metadata?.contractName, abi, descriptor };
}

function safeSelector(signature: string): string | undefined {
  try {
    return toFunctionSelector(`function ${signature}`).toLowerCase();
  } catch {
    return undefined;
  }
}
