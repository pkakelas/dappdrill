import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ChainConfig, DrillTarget, Suite, chainInfo, parseFixedResponse, parseStorageEntry, type Note, type Test } from "@dappdrill/core";

export class UsageError extends Error {}

/** Where the tests file is unless a command is told otherwise. */
export const TESTS_FILE = ".dappdrill/tests.json";

/**
 * The tests file `make` writes, `run` reads and `repair` writes again: commit it, run it in CI. It is
 * the app's suite (the setup, the notes, what may be signed, the tests) with where the app is and what
 * a run starts from.
 */
export const TestsFile = Suite.extend({
  url: z.string().url(),
  /** The chains the app used when its tests were made. `run` uses these unless --chain says otherwise. */
  chains: z.array(ChainConfig).default([]),
  /** The account the tests were made on, and what each new account is sent. `run` and `repair` use these unless --account or --fund says otherwise. */
  account: DrillTarget.shape.account,
  fund: DrillTarget.shape.fund,
});
export type TestsFile = z.infer<typeof TestsFile>;

/** The suite in a tests file, as the engine takes it. */
export function suiteOf(file: TestsFile): Suite {
  const { url: _url, chains: _chains, account: _account, fund: _fund, ...suite } = file;
  return suite;
}

export async function loadTests(path: string): Promise<TestsFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new UsageError(`Can't read ${path}: ${(e as Error).message}. Make one with: dappdrill make <url>`);
  }
  const parsed = TestsFile.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new UsageError(`${path} is not valid: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : parsed.error.message}`);
  }
  const ids = new Set<string>();
  for (const t of parsed.data.tests) {
    if (ids.has(t.id)) throw new UsageError(`${path}: two tests share the id ${t.id}`);
    ids.add(t.id);
  }
  return parsed.data;
}

/**
 * Adds to the tests file as it is on disk now, so what a command beside this one or a hand edit wrote
 * meanwhile stays: the notes it hasn't got, and the tests (one whose id is taken there gets another).
 * `fresh` is the file to start from when there is none yet. Returns the file as written.
 */
export async function addToTests(path: string, fresh: TestsFile, add: { notes?: Note[]; tests?: Test[] } & Partial<Pick<TestsFile, "chains" | "account" | "fund">>): Promise<TestsFile> {
  const now = (await access(path).then(() => true, () => false)) ? await loadTests(path) : fresh;
  const next: TestsFile = { ...now, chains: add.chains ?? now.chains, account: add.account ?? now.account, fund: add.fund ?? now.fund, notes: [...now.notes], tests: [...now.tests] };
  for (const note of add.notes ?? []) if (!next.notes.some((n) => n.text === note.text)) next.notes.push(note);
  for (const t of add.tests ?? []) {
    let test = t;
    for (let i = 2; next.tests.some((x) => x.id === test.id); i++) test = { ...t, id: `${t.id}-${i}` };
    next.tests.push(test);
  }
  await writeJson(path, next);
  return next;
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** "8453" or "8453=https://rpc" → a chain config. A chain we know needs no RPC. */
export function parseChain(spec: string): ChainConfig {
  const [idText, rpc] = spec.split(/=(.*)/s, 2);
  const id = Number(idText);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`Bad --chain "${spec}": expected <id>[=<rpc url>]`);
  const known = chainInfo(id);
  const rpcUrl = rpc || known?.rpcUrl;
  if (!rpcUrl) throw new UsageError(`Chain ${id} is not one we know; pass its RPC: --chain ${id}=https://…`);
  return { id, name: known?.name, rpcUrl };
}

/** --account new|kept */
export function parseAccount(value: string): DrillTarget["account"] {
  if (value !== "new" && value !== "kept") throw new UsageError(`Bad --account "${value}": expected new or kept`);
  return value;
}

/**
 * --fund 84532:0.05 sends each new account 0.05 of the chain's coin; --fund 84532:0x036C…CF7e:100 sends
 * it 100 of that token. Both come from the key that holds funds.
 */
export function parseFund(spec: string): DrillTarget["fund"][number] {
  const m = /^(\d+)(?::(0x[0-9a-fA-F]{40}))?:(\d+(?:\.\d+)?)$/.exec(spec);
  if (!m) throw new UsageError(`Bad --fund "${spec}": expected <chain id>[:<token address>]:<amount>`);
  return { chainId: Number(m[1]), ...(m[2] ? { token: m[2] } : {}), amount: m[3]! };
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

/** --storage testMode=true sets that localStorage entry on the app's origin before it loads. */
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
