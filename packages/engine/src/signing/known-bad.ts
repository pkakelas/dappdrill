/**
 * Known-bad lists: ScamSniffer's blacklist (addresses + domains) and
 * MetaMask's eth-phishing-detect domain blocklist. Fetched from GitHub raw,
 * cached on disk for a day. When a list can't be loaded we say so instead
 * of pretending the target is clean.
 */
import type { Http } from "./http.js";

const SCAMSNIFFER_ADDRESSES = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json";
const SCAMSNIFFER_DOMAINS = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json";
const METAMASK_CONFIG = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";
const DAY = 24 * 60 * 60 * 1000;

export interface KnownBadHit {
  kind: "address" | "domain";
  value: string;
  list: string;
}

export interface KnownBadResult {
  hits: KnownBadHit[];
  /** Lists that couldn't be loaded. */
  unavailable: string[];
}

export class KnownBad {
  private lists?: Promise<{ addresses: Set<string>; domains: Set<string>; unavailable: string[] }>;

  constructor(private readonly http: Http) {}

  async check(addresses: string[], domain: string | undefined): Promise<KnownBadResult> {
    const lists = await this.load();
    const hits: KnownBadHit[] = [];
    for (const a of new Set(addresses.map((x) => x.toLowerCase()))) {
      if (lists.addresses.has(a)) hits.push({ kind: "address", value: a, list: "ScamSniffer" });
    }
    if (domain) {
      const host = domain.toLowerCase();
      const parts = host.split(".");
      // The page's host or any parent domain of it.
      for (let i = 0; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join(".");
        if (lists.domains.has(candidate)) {
          hits.push({ kind: "domain", value: candidate, list: "ScamSniffer / MetaMask" });
          break;
        }
      }
    }
    return { hits, unavailable: lists.unavailable };
  }

  private load() {
    this.lists ??= this.fetchLists();
    return this.lists;
  }

  private async fetchLists() {
    const opts = { ttlMs: DAY, timeoutMs: 30_000 };
    const [addresses, domains, metamask] = await Promise.all([
      this.http.json<string[]>(SCAMSNIFFER_ADDRESSES, opts),
      this.http.json<string[]>(SCAMSNIFFER_DOMAINS, opts),
      this.http.json<{ blacklist?: string[] }>(METAMASK_CONFIG, opts),
    ]);
    const unavailable: string[] = [];
    if (!Array.isArray(addresses)) unavailable.push("ScamSniffer addresses");
    if (!Array.isArray(domains)) unavailable.push("ScamSniffer domains");
    if (!Array.isArray(metamask?.blacklist)) unavailable.push("MetaMask phishing list");
    const domainSet = new Set<string>();
    for (const d of domains ?? []) domainSet.add(d.toLowerCase());
    for (const d of metamask?.blacklist ?? []) domainSet.add(d.toLowerCase());
    return { addresses: new Set((addresses ?? []).map((a) => a.toLowerCase())), domains: domainSet, unavailable };
  }
}
