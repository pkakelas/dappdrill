import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ChainConfig, EdgeCaseId, Flow, SigningReview, chainInfo, type ScanReport } from "@dappdrill/core";

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

export function parseEdgeCases(csv: string): EdgeCaseId[] {
  const ids = csv.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((id) => !EdgeCaseId.safeParse(id).success);
  if (bad.length) throw new UsageError(`Unknown edge case(s): ${bad.join(", ")}. Known: ${EdgeCaseId.options.join(", ")}`);
  return ids as EdgeCaseId[];
}

export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
