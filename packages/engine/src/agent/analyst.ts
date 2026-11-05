/**
 * The analysis: a short look around the app to learn what it is, which pages
 * matter, and the three to five things its users most need to work. Each
 * becomes a happy-path test in plain English; the other things it saw come back
 * as a name and a goal. Nothing is recorded here, the first run of each test does that.
 */
import { z } from "zod";
import { AppMap, SetupDraft, TestDraft, TestIdea, describeBlock, type Blocked } from "@dappdrill/core";
import type { AgentTool, DrillSession, Inbox, Llm } from "../types.js";
import { formatSnapshot, takeSnapshot } from "./snapshot.js";
import { browserTools, inboxTool, Recorder } from "./tools.js";
import { walletLine } from "./tester.js";

export const ANALYZE_SYSTEM = `You get about two minutes in a web app (often a web3 dApp, with a test wallet injected on a local fork) to learn it and pick what to test.

1. Look around like a new user: the landing page, the main navigation, the pages where the real work happens. Connect the wallet if that unlocks the app. Don't send transactions, but do approve what a new user needs to get going (a sign-in, enabling the account, a faucet or mint for test funds) and see what it gives you: you can't tell what setup needs without it. The wallet is a throwaway test account.
2. Call note with one line each time you learn something that matters (a page and its purpose, what needs the wallet).
3. Call submit with:
   - a two-sentence summary of the app and the pages that matter,
   - setup, only when the app makes a new user do something before its core features work: sign in, mint or claim test funds from a faucet, make a first deposit. Its steps run before every test, so the tests start already signed in and funded and don't repeat them. Pick when it runs:
     - once (the default): one time per run. Also pick once when a step can't be repeated often, like a faucet with a limit ("once every 24h") or a sign-in that emails a code.
     - each: before every test, when the tests use up what setup gives on a live chain and setup is cheap to repeat (a mint button with no limit).
     Say why in one short sentence. Leave setup out when the core features work right after connecting the wallet. Keep only steps you saw were needed: once the core feature is usable, stop, so a faucet that already gives buying power needs no deposit after it.
   - what you found to test. Each one is something a user can go away happy having done: trade, swap, deposit, mint, borrow, claim. "Connect wallet", "Open the markets page" or "Switch network" are not tests of their own, they are steps inside one.
     tests: a happy-path test for the 3 to 5 things users most need to work (the app's core value), one test each. Where users put something in, include the way back out (withdraw, repay, close, unstake).
     untested: the other things you saw, with name and goal only, so the developer can see what isn't tested yet.
     A test's own needs (an open position before closing it) go in its steps; what every test needs goes in setup.
     You are told what the test wallet holds on the test chain. When the page shows less (0 ETH while it holds 100), the app reads balances from somewhere other than the test chain: that doesn't mean the action can't be tested, so still write the test for the real action (swap, deposit, trade), never a quote in its place. The run reports it if the page stops it.
     Apart from that, the test wallet has only the native coin and what setup gives it. Something that needs more ("No USDC on Arbitrum Sepolia", a card payment) goes under untested, and never in setup.
     When the developer lists what to test, those come first: find where each one happens and keep their wording in the name. Write tests for your own picks only if they listed fewer than 3. If a listed item isn't in the app, leave it out and say so with note.
     When the developer says what keeps breaking or what just changed, prefer tests that go through it.
     Use the rest of their notes too: leave alone what they say to avoid, use the tokens and amounts they give, and take expected from what they say success looks like.

Tests are read by busy developers. Write them plainly:
- name: what the user does, e.g. "Market buy on ETH perp".
- goal: one sentence.
- expected: one sentence about what the page shows at the end when it worked: final values ("Balance shows 5 USDC"), not changes ("rises by 5") or earlier moments, and no prices or rates that move. Amounts can be rounded on screen, so say "about 0.01 stETH".
- steps: 3 to 8 short imperative steps of 3 to 7 words, at the level a user thinks ("Connect the wallet", "Open the ETH market", "Enter 0.01 as size", "Click Buy", "Approve in the wallet", "Check the order in Positions"). No selectors, no refs.
Use small amounts. Skip docs, socials, settings and anything that leaves the app.

Never solve a CAPTCHA or bot check: call report_blocked. If the rest of the app still works, leave that page out, carry on and submit what you found.`;

const Submission = z.object({
  summary: AppMap.shape.summary,
  pages: AppMap.shape.pages.describe("The pages that matter, with their purpose"),
  setup: SetupDraft.optional().describe("Steps every test needs first (sign in, get test funds); leave out when there are none"),
  tests: z.array(TestDraft).min(1).max(8),
  untested: z.array(TestIdea).max(8).default([]).describe("Other things users do, seen but not written"),
});
type Submission = z.infer<typeof Submission>;

export interface AnalyzeOptions {
  /** Time to look around before submitting (default 120s). */
  maxMs?: number;
  /** Free-text hints from the user ("the swap page is under /trade"). */
  hints?: string;
  /** The app's tests so far, so a new analysis adds to them. Unwritten ones say so. */
  known?: string[];
  inbox?: Inbox;
  signal?: AbortSignal;
  /** A line for the live log. */
  onNote?: (text: string) => void;
}

export interface AnalyzeResult {
  map?: AppMap;
  setup?: SetupDraft;
  tests: TestDraft[];
  untested: TestIdea[];
  blocked?: Blocked;
}

export async function analyzeApp(session: DrillSession, llm: Llm, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const maxMs = opts.maxMs ?? 120_000;
  const started = Date.now();
  const notes: string[] = [];
  let submitted: Submission | undefined;
  let blocked: Blocked | undefined;
  const note = (text: string) => {
    notes.push(text);
    opts.onNote?.(text);
  };

  // Past the budget plus a grace period, stop the loop; a summary from the notes follows.
  const hard = new AbortController();
  const timer = setTimeout(() => hard.abort(), maxMs + 45_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, hard.signal]) : hard.signal;

  const tools: AgentTool[] = [
    ...browserTools({
      session,
      recorder: new Recorder(session),
      inbox: opts.inbox,
      onBlocked: (b) => {
        blocked = b;
        note(`${describeBlock(b)}: ${b.reason}`);
      },
      budgetNote: () => (Date.now() - started > maxMs ? "Time is up. Call submit now with what you have." : undefined),
    }),
    ...(opts.inbox ? [inboxTool(opts.inbox)] : []),
    {
      name: "note",
      description: "Record one short line about what you learned (shown live to the user).",
      schema: z.object({ text: z.string().max(140) }),
      handler: async ({ text }) => {
        note(text);
        return "Noted.";
      },
    },
    {
      name: "submit",
      description: "Submit the summary, the pages that matter, the setup if any, 3-5 happy-path tests, and the rest under untested with name and goal only. Ends the analysis.",
      schema: Submission,
      handler: async (input) => {
        submitted = input;
        return "Submitted. Stop now.";
      },
    },
  ];

  const snap = formatSnapshot(await takeSnapshot(session.page, { maxChars: 9_000 }));
  const prompt = [
    `App: ${session.target.url}`,
    await walletLine(session),
    opts.hints ? `Hints from the developer: ${opts.hints}` : "",
    opts.known?.length ? `The app already has these tests, so don't propose them again. You may write one marked not written yet; keep its name exactly:\n${opts.known.map((n) => `- ${n}`).join("\n")}` : "",
    "",
    "The landing page:",
    snap,
  ].filter(Boolean).join("\n");

  try {
    await llm.runAgent({ system: ANALYZE_SYSTEM, prompt, tools, maxTurns: 40, signal });
  } catch (e) {
    if (!signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
  }
  // A check on a side page only leaves that page out; the tests found elsewhere still stand.
  if (blocked && !submitted) return { tests: [], untested: [], blocked };
  if (!submitted && !opts.signal?.aborted && notes.length) {
    submitted = await llm
      .structured({
        system: ANALYZE_SYSTEM,
        prompt: `${prompt}\n\nYour notes from looking around:\n${notes.map((n) => `- ${n}`).join("\n")}\n\nSubmit now.`,
        schema: Submission,
        name: "submit",
      })
      .catch(() => undefined);
  }
  if (!submitted) return { tests: [], untested: [] };
  return { map: { summary: submitted.summary, pages: submitted.pages }, setup: submitted.setup, tests: submitted.tests, untested: submitted.untested };
}
