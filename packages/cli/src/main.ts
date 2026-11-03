import { Command } from "commander";
import { UsageError, collect } from "./files.js";
import { baselineAcceptCommand, describeCommand, pushFlowsCommand } from "./commands/misc.js";
import { runCommand } from "./commands/run.js";
import { scanCommand } from "./commands/scan.js";

/** Exit codes: 0 ok, 1 results at or above --fail-on, 2 usage or DappDrill error. */
function action<A extends unknown[]>(fn: (...args: A) => Promise<number>) {
  return async (...args: A) => {
    try {
      process.exitCode = await fn(...args);
    } catch (e) {
      const detail = e instanceof Error ? (process.env.DAPPDRILL_DEBUG ? e.stack : e.message) : String(e);
      console.error(e instanceof UsageError ? detail : `Error: ${detail}${process.env.DAPPDRILL_DEBUG ? "" : " (DAPPDRILL_DEBUG=1 for details)"}`);
      process.exitCode = 2;
    }
  };
}

const program = new Command("dappdrill").description("QA for web3 dApp frontends, on local forks.").showHelpAfterError();

program
  .command("scan")
  .description("Explore a dApp, save the flows it finds, run them under wallet edge cases and review every signature request.")
  .argument("<url>", "dApp URL")
  .option("--chain <id[=rpc]>", "chain to fork (repeatable); known chains need no RPC", collect, [])
  .option("--edge-cases <list>", "comma-separated edge cases (default: the standard set)")
  .option("--max-minutes <n>", "time budget")
  .option("--max-flows <n>", "stop after this many flows")
  .option("--hints <text>", "plain-English hints for the explorer")
  .option("--out <dir>", "output directory", "dappdrill-out")
  .option("--live-key-env <VAR>", "env var holding a funded testnet key for chains that can't be forked")
  .option("--token <chain:address=amount>", "ERC-20 balance for the test accounts on a fork (repeatable)", collect, [])
  .option("--init-script <file>", "JavaScript to run in every page before the dApp (repeatable)", collect, [])
  .option("--headed", "show the browser")
  .action(action((url: string, flags) => scanCommand(url, flags)));

program
  .command("run")
  .description("Replay saved flows deterministically. Exits 1 when results reach --fail-on.")
  .argument("[flows...]", "flow files (default: every .json in --flows-dir)")
  .option("--url <url>", "dApp URL (default with --pull: the app's URL)")
  .option("--flows-dir <dir>", "directory of flow files", ".dappdrill/flows")
  .option("--chain <id[=rpc]>", "chain to fork (repeatable)", collect, [])
  .option("--edge-cases <list>", "comma-separated edge cases (default: happy, or the app's with --pull)")
  .option("--baseline <file>", "accepted signing reviews", ".dappdrill/baselines.json")
  .option("--junit <file>", "write JUnit XML")
  .option("--out <dir>", "output directory", "dappdrill-out")
  .option("--fail-on <level>", "broken | review | never", "broken")
  .option("--pull", "also fetch the app's flows from the web app (needs --report-to)")
  .option("--report-to <app url>", "DappDrill web app to pull flows from and report results to")
  .option("--token-env <VAR>", "env var holding the app's API token", "DAPPDRILL_TOKEN")
  .option("--no-video", "don't record video")
  .option("--token <chain:address=amount>", "ERC-20 balance for the test accounts on a fork (repeatable)", collect, [])
  .option("--init-script <file>", "JavaScript to run in every page before the dApp (repeatable)", collect, [])
  .option("--headed", "show the browser")
  .action(action((files: string[], flags) => runCommand(files, flags)));

program
  .command("push-flows")
  .description("Upload the flow files in --flows-dir to the web app.")
  .option("--flows-dir <dir>", "directory of flow files", ".dappdrill/flows")
  .option("--report-to <app url>", "DappDrill web app")
  .option("--token-env <VAR>", "env var holding the app's API token", "DAPPDRILL_TOKEN")
  .action(action((flags) => pushFlowsCommand(flags)));

program
  .command("describe")
  .description("Turn a plain-English description into a flow by doing it on the site.")
  .argument("<description>", "what the flow should do")
  .requiredOption("--url <url>", "dApp URL")
  .option("--out <file>", "where to write the flow", "flow.json")
  .option("--flow <file>", "change this existing flow instead of creating one")
  .option("--headed", "show the browser")
  .action(action((description: string, flags) => describeCommand(description, flags)));

program
  .command("baseline")
  .description("Manage accepted signing reviews.")
  .command("accept")
  .description("Accept the signing reviews in a report as the new baseline.")
  .option("--from <report.json>", "report to accept", "dappdrill-out/report.json")
  .option("--baseline <file>", "baseline file", ".dappdrill/baselines.json")
  .action(action((flags) => baselineAcceptCommand(flags)));

await program.parseAsync();
