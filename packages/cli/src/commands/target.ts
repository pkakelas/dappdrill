import { DrillTarget, type ChainConfig, type DrillEventSink } from "@dappdrill/core";
import type { Command } from "commander";
import { UsageError, collect, parseChain, parseHeaders, parseResponses, parseStorage, parseToken, readInitScripts } from "../files.js";

export interface TargetFlags {
  chain: string[];
  liveKeyEnv?: string;
  token: string[];
  initScript: string[];
  header: string[];
  storage: string[];
  respond: string[];
  headed?: boolean;
  out: string;
}

/** How to open the app: the same flags for `analyze` and `run`. */
export function targetOptions(cmd: Command): Command {
  return cmd
    .option("--chain <id[=rpc]>", "chain to fork (repeatable); known chains need no RPC", collect, [])
    .option("--header <name: value>", "header for the app's own site only, e.g. your bot-protection bypass (repeatable; also $DAPPDRILL_HEADERS)", collect, [])
    .option("--storage <key=value>", "localStorage entry set before the app loads, e.g. a fork-mode flag (repeatable)", collect, [])
    .option("--respond <url [status] body|@file>", "answer requests to this URL (* wildcards) with a fixed body (repeatable)", collect, [])
    .option("--token <chain:address=amount>", "ERC-20 balance for the test wallet on a fork (repeatable)", collect, [])
    .option("--init-script <file>", "JavaScript to run in every page before the app (repeatable)", collect, [])
    .option("--live-key-env <VAR>", "env var holding a funded testnet key for chains that can't be forked")
    .option("--out <dir>", "where videos, screenshots and results go", "dappdrill-out")
    .option("--headed", "show the browser");
}

export async function buildTarget(url: string, flags: TargetFlags, learnedChains: ChainConfig[] = []): Promise<DrillTarget> {
  const liveKey = flags.liveKeyEnv ? process.env[flags.liveKeyEnv] : undefined;
  if (flags.liveKeyEnv && !liveKey) throw new UsageError(`${flags.liveKeyEnv} is not set.`);
  const parsed = DrillTarget.safeParse({
    url,
    chains: flags.chain.map(parseChain),
    learnedChains,
    liveKey,
    tokens: flags.token.map(parseToken),
    initScripts: await readInitScripts(flags.initScript),
    headers: parseHeaders(flags.header),
    storage: parseStorage(flags.storage),
    responses: await parseResponses(flags.respond),
  });
  if (!parsed.success) throw new UsageError(`Bad target: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
/** Only problems get colour. */
export const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
export const dim = (s: string) => (useColour ? `\x1b[2m${s}\x1b[0m` : s);

/** The engine's log lines; frames and wallet chatter are left out. */
export const logSink: DrillEventSink = (event) => {
  if (event.type === "log") console.log(event.level === "info" ? dim(`  ${event.message}`) : red(`  ${event.message}`));
};
