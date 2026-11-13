import { Command, CommanderError } from "commander";
import { UsageError } from "./files.js";
import { makeCommand } from "./commands/make.js";
import { runCommand } from "./commands/run.js";
import { targetOptions } from "./commands/target.js";

const TESTS_FILE = ".dappdrill/tests.json";

const EXIT_CODES = `
Exit codes:
  0  everything passed
  1  a test failed, or a signature was Dangerous (even on a test that passed)
  2  the only problem is a test that couldn't be verified, a run that was stopped, nothing ran, or DappDrill itself (bad flags, blocked, no tests)`;

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
    .command("make")
    .description("Look at the app and make a test for each thing users do there. A test is kept once it goes the same way twice in a row.")
    .argument("<url>", "the app's URL")
    .option("--file <path>", "the tests file to write, or to add to", TESTS_FILE)
    .option("--count <n>", "how many goals to make a test for (10 unless said)")
    .option("--goal <text>", "make one test, for this goal, instead of looking")
    .option("--start <path>", "with --goal: the page the test starts on"),
)
  .addHelpText("after", "\nExits 0 when a test was added to the file, 2 when none was.")
  .action(action((url: string, flags) => makeCommand(url, flags)));

targetOptions(
  program
    .command("run")
    .description("Run the tests in a tests file.")
    .argument("[file]", "tests file", TESTS_FILE)
    .option("--url <url>", "run against this URL instead, e.g. a preview deploy")
    .option("--only <text>", "only tests whose name contains this")
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
