import type { FixedResponse } from "./run.js";

/** "forkEnabled=true" → ["forkEnabled", "true"]; undefined without a key. Splits on the first "=". */
export function parseStorageEntry(spec: string): [string, string] | undefined {
  const i = spec.indexOf("=");
  return i > 0 ? [spec.slice(0, i).trim(), spec.slice(i + 1).trim()] : undefined;
}

/** "<url> [status] <body>" → a fixed response; undefined when it doesn't parse. */
export function parseFixedResponse(spec: string): FixedResponse | undefined {
  const m = /^\s*(\S+)\s+(?:([1-5]\d\d)\s+)?([\s\S]+?)\s*$/.exec(spec);
  return m ? { url: m[1]!, status: m[2] ? Number(m[2]) : 200, body: m[3]! } : undefined;
}

/** The line parseFixedResponse reads back. */
export function formatFixedResponse(r: FixedResponse): string {
  return [r.url, r.status === 200 ? undefined : r.status, r.body].filter((x) => x !== undefined).join(" ");
}
