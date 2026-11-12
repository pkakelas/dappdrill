/** What the dev commands share: the app's target from the command line, and where results go. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DrillTarget, type ChainConfig } from "@dappdrill/core";

/** A file named on the command line, from where the command was typed. */
export const fromCwd = (name: string) => path.resolve(process.env.INIT_CWD ?? ".", name);

/**
 * `target` is a target.json that `pnpm drill` kept for the app: its test accounts, the chains it
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
