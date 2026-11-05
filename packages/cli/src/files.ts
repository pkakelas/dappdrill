import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { AppMap, AppSetup, ChainConfig, TestSpec, chainInfo, parseFixedResponse, parseStorageEntry, type DrillTarget } from "@dappdrill/core";

export class UsageError extends Error {}

/** The tests file `analyze` writes and `run` reads: commit it, run it in CI. */
export const SavedTest = TestSpec.extend({
  /** For an unhappy path: the test it runs under its condition. */
  baseId: z.string().optional(),
});
export type SavedTest = z.infer<typeof SavedTest>;

export const TestsFile = z.object({
  url: z.string().url(),
  map: AppMap.optional(),
  /** Chains the app used when it was analyzed; `run` forks these unless --chain says otherwise. */
  chains: z.array(ChainConfig).default([]),
  /** Steps every test needs first (sign in, get test funds), and when they run. */
  setup: AppSetup.optional(),
  flows: z.array(z.object({ name: z.string(), goal: z.string().optional(), tests: z.array(SavedTest) })),
});
export type TestsFile = z.infer<typeof TestsFile>;

/** "Flow · Test", or "Flow · Test · Condition": a condition's name alone can't tell two tests apart. */
export function testLabels(tests: TestsFile): Map<string, string> {
  const byId = new Map(tests.flows.flatMap((f) => f.tests).map((t) => [t.id, t]));
  return new Map(
    tests.flows.flatMap((f) =>
      f.tests.map((t) => {
        const base = t.baseId ? byId.get(t.baseId) : undefined;
        return [t.id, [f.name, base?.name, t.name].filter(Boolean).join(" · ")] as const;
      }),
    ),
  );
}

export async function loadTests(path: string): Promise<TestsFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new UsageError(`Can't read ${path}: ${(e as Error).message}. Make one with: dappdrill analyze <url>`);
  }
  const parsed = TestsFile.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new UsageError(`${path} is not valid: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : parsed.error.message}`);
  }
  const ids = new Set<string>();
  for (const t of parsed.data.flows.flatMap((f) => f.tests)) {
    if (ids.has(t.id)) throw new UsageError(`${path}: two tests share the id ${t.id}`);
    ids.add(t.id);
  }
  return parsed.data;
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
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
      return { ...r, body: await readOrExplain(r.body.slice(1)) };
    }),
  );
}

export async function readInitScripts(paths: string[]): Promise<string[]> {
  return Promise.all(paths.map(readOrExplain));
}

function readOrExplain(path: string): Promise<string> {
  return readFile(path, "utf8").catch((e: Error) => {
    throw new UsageError(`Can't read ${path}: ${e.message}`);
  });
}

export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
