import { Command, CommanderError } from "commander";
import { CONDITIONS } from "@dappdrill/core";
import { UsageError, collect } from "./files.js";
import { analyzeCommand } from "./commands/analyze.js";
import { runCommand } from "./commands/run.js";
import { targetOptions } from "./commands/target.js";

const TESTS_FILE = ".dappdrill/tests.json";
const UNHAPPY = "add the usual unhappy paths (rejected in wallet, slow RPC, …) to tests that ask the wallet to sign";
const FAIL_ON_DANGEROUS = "exit 1 when a signing request is Dangerous, even if the tests passed";
const CONDITION = `add this unhappy path too (repeatable): ${CONDITIONS.map((c) => c.id).join(", ")}`;

/** Exit codes: 0 all passed, 1 a test failed (or --fail-on-dangerous tripped), 2 usage, a test couldn't run, the run stopped, or nothing ran. */
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

const program = new Command("dappdrill").description("Tests for web3 apps, run on local forks.").showHelpAfterError().exitOverride();

targetOptions(
  program
    .command("analyze")
    .description("Use the app for about two minutes, write a test for each of its main flows, then run them.")
    .argument("<url>", "the app's URL")
    .option("--file <path>", "where to write the tests", TESTS_FILE)
    .option("--hints <text>", "where things are, what to use")
    .option("--max-minutes <n>", "time to spend looking around")
    .option("--unhappy", UNHAPPY)
    .option("--condition <id>", CONDITION, collect, [])
    .option("--fail-on-dangerous", FAIL_ON_DANGEROUS)
    .option("--no-run", "only write the tests")
    .option("--junit <file>", "write JUnit XML")
    .option("--force", "replace an existing tests file"),
).action(action((url: string, flags) => analyzeCommand(url, flags)));

targetOptions(
  program
    .command("run")
    .description("Run the tests in a tests file. Exits 1 when one fails, 2 when one couldn't run or nothing ran.")
    .argument("[file]", "tests file", TESTS_FILE)
    .option("--url <url>", "run against this URL instead, e.g. a preview deploy")
    .option("--only <text>", "only tests whose flow or name contains this, with their unhappy paths")
    .option("--unhappy", UNHAPPY)
    .option("--condition <id>", CONDITION, collect, [])
    .option("--fail-on-dangerous", FAIL_ON_DANGEROUS)
    .option("--junit <file>", "write JUnit XML"),
).action(action((file: string, flags) => runCommand(file, flags)));

try {
  await program.parseAsync();
} catch (e) {
  if (!(e instanceof CommanderError)) throw e;
  // Commander has printed the message; --help exits 0, and bad usage is a 2 here, not a failed test.
  process.exitCode = e.exitCode === 0 ? 0 : 2;
}
