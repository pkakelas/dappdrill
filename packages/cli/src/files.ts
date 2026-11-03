import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ChainConfig, EdgeCaseId, Flow, SigningReview, chainInfo, parseFixedResponse, parseStorageEntry, type DrillTarget, type ScanReport } from "@dappdrill/core";

export class UsageError extends Error {}

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new UsageError(`Can't read ${path}: ${(e as Error).message}`);
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function parseOrExplain<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new UsageError(`${what} is not valid: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : parsed.error.message}`);
  }
  return parsed.data;
}

/** Flow files given explicitly, or every *.json in `dir` (missing dir = no flows). */
export async function loadFlows(files: string[], dir: string): Promise<Flow[]> {
  let paths = files;
  if (paths.length === 0) {
    if (!existsSync(dir)) return [];
    paths = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));
  }
  const flows: Flow[] = [];
  for (const path of paths) flows.push(parseOrExplain(Flow, await readJson(path), path));
  const ids = new Set<string>();
  for (const f of flows) {
    if (ids.has(f.id)) throw new UsageError(`Two flows share the id ${f.id}`);
    ids.add(f.id);
  }
  return flows;
}

export async function saveFlows(flows: Flow[], dir: string): Promise<void> {
  for (const flow of flows) await writeJson(join(dir, `${flow.id}.json`), flow);
}

export const Baselines = z.record(z.string(), SigningReview);
export type Baselines = z.infer<typeof Baselines>;

export async function loadBaselines(path: string | undefined): Promise<Baselines> {
  if (!path || !existsSync(path)) return {};
  return parseOrExplain(Baselines, await readJson(path), path);
}

export async function loadReport(path: string, schema: z.ZodType<ScanReport>): Promise<ScanReport> {
  return parseOrExplain(schema, await readJson(path), path);
}

/** "8453" or "8453=https://rpc" → a chain config; chains we know can't be forked run live. */
export function parseChain(spec: string): ChainConfig {
  const [idText, rpc] = spec.split(/=(.*)/s, 2);
  const id = Number(idText);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`Bad --chain "${spec}": expected <id>[=<rpc url>]`);
  const known = chainInfo(id);
  const rpcUrl = rpc || known?.rpcUrl;
  if (!rpcUrl) throw new UsageError(`Chain ${id} is not one we know; pass its RPC: --chain ${id}=https://…`);
  return { id, name: known?.name, rpcUrl, mode: known && !known.forkable ? "live" : "fork" };
}

/** --token 1:0xA0b8…eB48=5000 gives the test accounts 5,000 of that token on the chain-1 fork. */
export function parseToken(spec: string): DrillTarget["tokens"][number] {
  const m = /^(\d+):(0x[0-9a-fA-F]{40})=(\d+(\.\d+)?)$/.exec(spec);
  if (!m) throw new UsageError(`Bad --token "${spec}": expected <chain id>:<token address>=<amount>`);
  return { chainId: Number(m[1]), address: m[2]!, amount: m[3]! };
}

/**
 * Headers for the app's own site: each --header "Name: value", plus one per line of
 * $DAPPDRILL_HEADERS (so a CI secret stays out of the command line).
 */
export function parseHeaders(specs: string[], env = process.env.DAPPDRILL_HEADERS): Record<string, string> {
  const lines = [...(env ?? "").split("\n").filter((l) => l.trim()), ...specs];
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const m = /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m || !m[2]) throw new UsageError(`Bad header "${line.split(":")[0]}…": expected "Name: value"`);
    headers[m[1]!.toLowerCase()] = m[2];
  }
  return headers;
}

/** --storage forkEnabled=true sets that localStorage entry on the app's origin before it loads. */
export function parseStorage(specs: string[]): Record<string, string> {
  const storage: Record<string, string> = {};
  for (const spec of specs) {
    const entry = parseStorageEntry(spec);
    if (!entry) throw new UsageError(`Bad --storage "${spec}": expected key=value`);
    storage[entry[0]] = entry[1];
  }
  return storage;
}

/**
 * --respond "<url> [status] <body|@file>" answers matching requests with that body
 * (`*` wildcards in the URL; @file reads the body from a file).
 */
export async function parseResponses(specs: string[]): Promise<DrillTarget["responses"]> {
  return Promise.all(
    specs.map(async (spec) => {
      const r = parseFixedResponse(spec);
      if (!r) throw new UsageError(`Bad --respond "${spec}": expected "<url> [status] <body or @file>"`);
      if (!r.body.startsWith("@")) return r;
      const file = r.body.slice(1);
      const body = await readFile(file, "utf8").catch((e: Error) => {
        throw new UsageError(`Can't read ${file}: ${e.message}`);
      });
      return { ...r, body };
    }),
  );
}

export async function readInitScripts(paths: string[]): Promise<string[]> {
  return Promise.all(
    paths.map((p) =>
      readFile(p, "utf8").catch((e: Error) => {
        throw new UsageError(`Can't read ${p}: ${e.message}`);
      }),
    ),
  );
}

export function parseEdgeCases(csv: string): EdgeCaseId[] {
  const ids = csv.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((id) => !EdgeCaseId.safeParse(id).success);
  if (bad.length) throw new UsageError(`Unknown edge case(s): ${bad.join(", ")}. Known: ${EdgeCaseId.options.join(", ")}`);
  return ids as EdgeCaseId[];
}

export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
