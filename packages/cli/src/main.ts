import { Command, CommanderError } from "commander";
import { TESTS_FILE, UsageError } from "./files.js";
import { makeCommand } from "./commands/make.js";
import { repairCommand } from "./commands/repair.js";
import { runCommand } from "./commands/run.js";
import { targetOptions } from "./commands/target.js";

const EXIT_CODES = `
Exit codes:
  0  everything passed
  1  a test failed, or a signature was Dangerous (even on a test that passed)
  2  the only problem is a test that couldn't be verified (one that needs repairing says so), a run that was stopped, nothing ran, or DappDrill itself (bad flags, blocked, no tests)`;

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

const program = new Command("dappdrill").description("Tests for web3 apps, run on the chains the app uses.").showHelpAfterError().exitOverride();

targetOptions(
  program
    .command("make")
    .description("Look at the app and make a test for each thing users do there. A test is kept once it goes the same way twice in a row.")
    .argument("<url>", "the app's URL")
    .option("--file <path>", "the tests file to write, or to add to", TESTS_FILE)
    .option("--count <n>", "how many goals to make a test for (every goal the look lists, up to 20, unless said)")
    .option("--goal <text>", "make one test, for this goal, instead of looking")
    .option("--start <path>", "with --goal: the page the test starts on"),
)
  .addHelpText("after", "\nExits 0 when a test was added to the file, 2 when none was.")
  .action(action((url: string, flags) => makeCommand(url, flags)));

targetOptions(
  program
    .command("run")
    .description("Run the tests in a tests file. Every line is done by code, so a run needs no API key.")
    .argument("[file]", "tests file", TESTS_FILE)
    .option("--url <url>", "run against this URL instead, e.g. a preview deploy")
    .option("--only <text>", "only tests whose name contains this")
    .option("--at-once <n>", "how many tests run at the same time on new accounts (4 when left out)")
    .option("--junit <file>", "write JUnit XML"),
)
  .addHelpText("after", EXIT_CODES)
  .action(action((file: string, flags) => runCommand(file, flags)));

targetOptions(
  program
    .command("repair")
    .description("Write the tests as code again: the lines that aren't code yet, and the ones whose code stopped working. A model does them once and what it did is kept, so this needs ANTHROPIC_API_KEY or the Claude Code login.")
    .argument("[file]", "tests file", TESTS_FILE)
    .option("--only <text>", "only tests whose name contains this"),
)
  .addHelpText("after", "\nExits 0 when everything that needed repairing was repaired, 2 when a test was left as it is.")
  .action(action((file: string, flags) => repairCommand(file, flags)));

try {
  await program.parseAsync();
} catch (e) {
  if (!(e instanceof CommanderError)) throw e;
  // Commander has printed the message; --help exits 0, and bad usage is a 2 here, not a failed test.
  process.exitCode = e.exitCode === 0 ? 0 : 2;
}
