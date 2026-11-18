import { DrillTarget } from "@dappdrill/core";
import type { Command } from "commander";
import { UsageError, collect, parseAccount, parseChain, parseFund, parseHeaders, parseResponses, parseStorage, readInitScripts, type TestsFile } from "../files.js";

export interface TargetFlags {
  chain: string[];
  account?: string;
  key?: string;
  fund: string[];
  initScript: string[];
  header: string[];
  storage: string[];
  respond: string[];
  headed?: boolean;
  out: string;
}

/** How to open the app: the same flags for every command. */
export function targetOptions(cmd: Command): Command {
  return cmd
    .option("--chain <id[=rpc]>", "a chain the app uses (repeatable); known chains need no RPC", collect, [])
    .option("--account <new|kept>", "new: every test starts on an account of its own. kept: every run uses the account of --key")
    .option("--key <hex>", "private key of the account that holds funds (also $DAPPDRILL_KEY)")
    .option("--fund <chain[:token]:amount>", "what the key sends each new account: the chain's coin, or the token at that address (repeatable)", collect, [])
    .option("--header <name: value>", "header for the app's own site only, e.g. your bot-protection bypass (repeatable; also $DAPPDRILL_HEADERS)", collect, [])
    .option("--storage <key=value>", "localStorage entry set before the app loads, e.g. a test-mode flag (repeatable)", collect, [])
    .option("--respond <url [status] body|@file>", "answer requests to this URL (* wildcards) with a fixed body (repeatable)", collect, [])
    .option("--init-script <file>", "JavaScript to run in every page before the app (repeatable)", collect, [])
    .option("--out <dir>", "where videos, screenshots and results go", "dappdrill-out")
    .option("--headed", "show the browser");
}

/**
 * `use` says what the chains in the tests file are for. A look finds the app's chains again, so they
 * are only chains to have ready. Tests (run, repaired, or one more made) use them unless --chain names
 * others. The account and what each new one is sent come from the file too, unless a flag says
 * otherwise; the key never does.
 */
export async function buildTarget(url: string, flags: TargetFlags, use: "look" | "tests", file?: Pick<TestsFile, "chains" | "account" | "fund">): Promise<DrillTarget> {
  const fundedKey = flags.key ?? (process.env.DAPPDRILL_KEY || undefined);
  if (fundedKey && !/^(0x)?[0-9a-fA-F]{64}$/.test(fundedKey)) throw new UsageError("Bad key: expected a private key of 64 hex characters.");
  const account = flags.account ? parseAccount(flags.account) : (file?.account ?? "new");
  if (account === "kept" && !fundedKey) throw new UsageError("A kept account needs its key: pass --key or set $DAPPDRILL_KEY.");
  const fund = flags.fund.length ? flags.fund.map(parseFund) : (file?.fund ?? []);
  if (account === "new" && fund.length && !fundedKey) throw new UsageError("New accounts are sent funds from a key: pass --key or set $DAPPDRILL_KEY.");
  const asked = flags.chain.map(parseChain);
  const seen = file?.chains ?? [];
  const parsed = DrillTarget.safeParse({
    url,
    chains: use === "tests" && asked.length === 0 ? seen : asked,
    learnedChains: use === "look" ? seen.filter((c) => c.fromApp) : [],
    account,
    fundedKey,
    fund,
    initScripts: await readInitScripts(flags.initScript),
    headers: parseHeaders(flags.header),
    storage: parseStorage(flags.storage),
    responses: await parseResponses(flags.respond),
  });
  if (!parsed.success) throw new UsageError(`Bad target: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}
