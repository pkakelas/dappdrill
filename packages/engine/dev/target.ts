/** What the dev commands share: the app's target from the command line, where results go, writing to a suite file and printing a line. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chainInfo, DrillTarget, sentence, Suite, type Action, type ChainConfig, type Check, type Note, type Test } from "@dappdrill/core";

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

/** The flags every dev command takes to say which accounts and chains the app is tested with. */
export const TARGET_FLAGS = {
  account: { type: "string" },
  key: { type: "string" },
  fund: { type: "string", multiple: true },
  chain: { type: "string", multiple: true },
  target: { type: "string" },
  "keep-wallet": { type: "boolean" },
} as const;
export const TARGET_USAGE = "[--account new|kept] [--key hex] [--fund chainId[:token]:amount]… [--chain id[=rpc]]… [--target file] [--keep-wallet]";

export interface TargetFlags {
  account?: string;
  key?: string;
  fund?: string[];
  chain?: string[];
  target?: string;
  "keep-wallet"?: boolean;
}

/**
 * The app's target from the command line.
 *
 * --account new: every test gets a wallet of its own, sent what each --fund lists from --key
 * (`31337:10` is 10 of chain 31337's coin, `31337:0xToken:1000` is 1000 of that ERC-20).
 * --account kept: every test is the same user, --key as account A when it is given. With neither
 * --key nor --target that user is made for this command and gone after it.
 * --target is a target.json kept for the app: its test accounts, the chains it learned and its inbox.
 * The file is only read, and its accounts are kept ones: an app that makes a user of every new wallet
 * sees the one it already knows. --keep-wallet says the same as --account kept.
 */
export async function loadTarget(url: string, flags: TargetFlags): Promise<DrillTarget> {
  const kept: Partial<Pick<DrillTarget, "accounts" | "inbox">> & { chains?: ChainConfig[] } = flags.target ? JSON.parse(await readFile(fromCwd(flags.target), "utf8")) : {};
  return DrillTarget.parse({
    url,
    account: flags.account ?? (flags["keep-wallet"] || flags.target ? "kept" : "new"),
    accounts: kept.accounts,
    fundedKey: flags.key,
    fund: (flags.fund ?? []).map((f) => {
      const parts = f.split(":");
      if (parts.length < 2 || parts.length > 3) throw new Error(`--fund ${f}: write it as chainId:amount or chainId:token:amount.`);
      return { chainId: Number(parts[0]), token: parts.length === 3 ? parts[1] : undefined, amount: parts.at(-1)! };
    }),
    learnedChains: kept.chains,
    inbox: kept.inbox,
    chains: (flags.chain ?? []).map((c) => {
      const [id, rpc] = c.split("=");
      const rpcUrl = rpc ?? chainInfo(Number(id))?.rpcUrl;
      if (!rpcUrl) throw new Error(`--chain ${c}: chain ${id} isn't one we know, so give its RPC as ${id}=<url>.`);
      return { id: Number(id), rpcUrl };
    }),
  });
}

/** .drill/<kind>/<host>/<time>/ at the top of the repository. */
export function outDir(kind: string, url: string): string {
  return path.resolve(import.meta.dirname, "../../../.drill", kind, new URL(url).host, new Date().toISOString().replace(/[:.]/g, "-"));
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`.padStart(6);
export const usd = (n: number) => (n ? `$${n.toFixed(4)}` : "").padStart(8);

/** A line as it was written: its sentence, how it went when `how` says, and under it the check's code or how much was recorded. */
export function printWritten(n: number | string, line: Action | Check, how?: string): void {
  console.log(`  ${String(n).padStart(2)}  ${line.type.padEnd(6)} ${line.by.padEnd(4)}${how ? ` ${how}` : ""}  ${sentence(line)}`);
  if (line.type === "check" && line.by === "code") console.log(`        ${JSON.stringify(line.expect)}`);
  if (line.type === "action" && line.by === "code") console.log(`        ${line.run.length ? `${line.run.length} recorded` : "not recorded"}`);
}
