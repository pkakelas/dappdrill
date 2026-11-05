import { Command, CommanderError } from "commander";
import { CONDITIONS } from "@dappdrill/core";
import { UsageError, collect } from "./files.js";
import { analyzeCommand } from "./commands/analyze.js";
import { runCommand } from "./commands/run.js";
import { targetOptions } from "./commands/target.js";

const TESTS_FILE = ".dappdrill/tests.json";
const UNHAPPY = "add the usual conditions (rejected in wallet, slow RPC, …) to tests that ask the wallet to sign";
const CONDITION = `add this condition too (repeatable): ${CONDITIONS.filter((c) => c.id !== "happy").map((c) => c.id).join(", ")}`;

const EXIT_CODES = `
Exit codes:
  0  everything passed
  1  a test failed, or a signature was Dangerous (even on a test that passed)
  2  the only problem is a test that couldn't run, a run that was stopped, nothing ran, or DappDrill itself (bad flags, blocked, no tests found)`;

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
    .description("Use the app for about two minutes, write tests for the main things users do, then run them.")
    .argument("<url>", "the app's URL")
    .option("--file <path>", "where to write the tests", TESTS_FILE)
    .option("--hints <text>", "where things are, what to use")
    .option("--max-minutes <n>", "time to spend looking around")
    .option("--conditions, --unhappy", UNHAPPY)
    .option("--condition <id>", CONDITION, collect, [])
    .option("--no-run", "only write the tests")
    .option("--junit <file>", "write JUnit XML")
    .option("--force", "replace an existing tests file"),
)
  .addHelpText("after", EXIT_CODES)
  .action(action((url: string, flags) => analyzeCommand(url, flags)));

targetOptions(
  program
    .command("run")
    .description("Run the tests in a tests file.")
    .argument("[file]", "tests file", TESTS_FILE)
    .option("--url <url>", "run against this URL instead, e.g. a preview deploy")
    .option("--only <text>", "only tests whose name contains this")
    .option("--conditions, --unhappy", UNHAPPY)
    .option("--condition <id>", CONDITION, collect, [])
    .option("--junit <file>", "write JUnit XML"),
)
  .addHelpText("after", EXIT_CODES)
  .action(action((file: string, flags) => runCommand(file, flags)));

try {
  await program.parseAsync();
} catch (e) {
  if (!(e instanceof CommanderError)) throw e;
  // Commander has printed the message; --help exits 0, and bad usage is a 2 here, not a failed test.
  process.exitCode = e.exitCode === 0 ? 0 : 2;
}
