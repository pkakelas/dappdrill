/** What the dev commands share: the app's target from the command line, where results go, and writing to a suite file. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DrillTarget, Suite, type ChainConfig, type Note, type Test } from "@dappdrill/core";

/** The suite in a file, or `fresh` when there is no file yet. */
export async function readSuite(file: string, fresh: unknown = {}): Promise<Suite> {
  const kept = await readFile(file, "utf8").catch(() => undefined);
  return Suite.parse(kept ? JSON.parse(kept) : fresh);
}

/**
 * Adds to the suite file as it is on disk now, so a hand edit or a command beside this one isn't lost:
 * the notes it hasn't got, and the tests (one whose id is taken there gets another). `fresh` is what a
 * new file starts from. Returns the suite as written.
 */
export async function addToSuite(file: string, fresh: unknown, add: { notes?: Note[]; tests?: Test[] }): Promise<Suite> {
  const next = await readSuite(file, fresh);
  for (const note of add.notes ?? []) if (!next.notes.some((n) => n.text === note.text)) next.notes.push(note);
  for (const t of add.tests ?? []) {
    let test = t;
    for (let i = 2; next.tests.some((x) => x.id === test.id); i++) test = { ...t, id: `${t.id}-${i}` };
    next.tests.push(test);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** A file named on the command line, from where the command was typed. */
export const fromCwd = (name: string) => path.resolve(process.env.INIT_CWD ?? ".", name);

/**
 * `target` is a target.json kept for the app: its test accounts, the chains it
 * learned and its inbox. Account A is then the key on chains that can't be forked, so an app that
 * makes a user of every new wallet sees the one it already knows. The file is only read.
 */
export async function loadTarget(url: string, flags: { target?: string; chain?: string[] }): Promise<DrillTarget> {
  const kept: Pick<DrillTarget, "accounts" | "tokens" | "inbox"> & { chains?: ChainConfig[] } = flags.target ? JSON.parse(await readFile(fromCwd(flags.target), "utf8")) : {};
  return DrillTarget.parse({
    url,
    accounts: kept.accounts,
    liveKey: kept.accounts?.A,
    learnedChains: kept.chains,
    tokens: kept.tokens,
    inbox: kept.inbox,
    chains: (flags.chain ?? []).map((c) => {
      const [id, rpcUrl] = c.split("=");
      return { id: Number(id), rpcUrl, mode: "fork" };
    }),
  });
}

/** .drill/<kind>/<host>/<time>/ at the top of the repository. */
export function outDir(kind: string, url: string): string {
  return path.resolve(import.meta.dirname, "../../../.drill", kind, new URL(url).host, new Date().toISOString().replace(/[:.]/g, "-"));
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`.padStart(6);
export const usd = (n: number) => (n ? `$${n.toFixed(4)}` : "").padStart(8);
