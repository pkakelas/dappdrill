/**
 * Sends back to the funding key what a run's test accounts still hold: for a run that was cut short
 * before it could do so itself (a worker restarted, a machine that went down).
 *
 *   pnpm collect <run id> --key hex --chain id[=rpc]… [--fund chainId:token:amount]… [--count n]
 *
 * The run id is in the run's artifacts, in test-accounts.json. --key is the key that paid the accounts:
 * they are made from it and the id, so nothing else is needed to empty them. Each --chain is looked at
 * for its coin, and each --fund with a token names an ERC-20 to look for (its amount says nothing here).
 * --count is how many of the run's starts are gone through, 40 unless said.
 */
import { parseArgs } from "node:util";
import { chainInfo } from "@dappdrill/core";
import { startChains } from "../src/runtime.js";
import { newAccounts } from "../src/run/env.js";
import { sendBack } from "../src/run/sweep.js";
import { readFunds } from "./target.js";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { key: { type: "string" }, chain: { type: "string", multiple: true }, fund: { type: "string", multiple: true }, count: { type: "string" } },
});
const [runId] = positionals;
if (!runId || !flags.key || !flags.chain?.length) {
  console.error("usage: pnpm collect <run id> --key hex --chain id[=rpc]… [--fund chainId:token:amount]… [--count n]");
  process.exit(2);
}

const chains = startChains(
  flags.chain.map((c) => {
    const [id, rpc] = c.split("=");
    const rpcUrl = rpc ?? chainInfo(Number(id))?.rpcUrl;
    if (!rpcUrl) throw new Error(`--chain ${c}: chain ${id} isn't one we know, so give its RPC as ${id}=<url>.`);
    return { id: Number(id), name: chainInfo(Number(id))?.name, rpcUrl };
  }),
  {},
);
const known = readFunds(flags.fund ?? [], "--fund");
let lines = 0;
try {
  for (let n = 1; n <= Number(flags.count ?? 40); n++) {
    await sendBack(chains, flags.key, newAccounts({ fundedKey: flags.key, runId }, n), known, (message) => {
      lines++;
      console.log(message);
    });
  }
} finally {
  await chains.close();
}
if (!lines) console.log("Nothing was left on that run's accounts.");
process.exit(0);
