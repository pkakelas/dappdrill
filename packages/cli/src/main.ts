import { Command } from "commander";
import { UsageError } from "./files.js";
import { analyzeCommand } from "./commands/analyze.js";
import { runCommand } from "./commands/run.js";
import { targetOptions } from "./commands/target.js";

const TESTS_FILE = ".dappdrill/tests.json";

/** Exit codes: 0 all passed, 1 a test failed, 2 usage or DappDrill couldn't run. */
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

const program = new Command("dappdrill").description("Tests for web3 apps, run on local forks.").showHelpAfterError();

targetOptions(
  program
    .command("analyze")
    .description("Use the app for about two minutes, write a test for each of its main flows, then run them.")
    .argument("<url>", "the app's URL")
    .option("--file <path>", "where to write the tests", TESTS_FILE)
    .option("--hints <text>", "where things are, what to use")
    .option("--max-minutes <n>", "time to spend looking around")
    .option("--unhappy", "also add the usual unhappy paths (rejected in wallet, slow RPC, …)")
    .option("--no-run", "only write the tests")
    .option("--junit <file>", "write JUnit XML")
    .option("--force", "replace an existing tests file"),
).action(action((url: string, flags) => analyzeCommand(url, flags)));

targetOptions(
  program
    .command("run")
    .description("Run the tests in a tests file. Exits 1 when one fails.")
    .argument("[file]", "tests file", TESTS_FILE)
    .option("--url <url>", "run against this URL instead, e.g. a preview deploy")
    .option("--only <text>", "only tests whose flow or name contains this")
    .option("--unhappy", "add the usual unhappy paths to tests that don't have them")
    .option("--junit <file>", "write JUnit XML"),
).action(action((file: string, flags) => runCommand(file, flags)));

await program.parseAsync();
