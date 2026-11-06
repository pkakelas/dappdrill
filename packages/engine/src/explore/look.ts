/**
 * The look: a minute or two in the app to learn what it is, what a new user has to do first, and
 * which features it has. Each feature comes back with the tests worth having, which explorers
 * then try. Nothing is saved from here: a suggested test still has to prove itself.
 */
import { z } from "zod";
import { AppMap, SetupDraft, TestDraft, Tier, describeBlock, type Blocked } from "@dappdrill/core";
import { formatSnapshot, takeSnapshot } from "../agent/snapshot.js";
import { walletLine } from "../agent/tester.js";
import { browserTools, inboxTool, Recorder } from "../agent/tools.js";
import type { AgentTool, DrillSession, Inbox, Llm } from "../types.js";
import type { KnownTest } from "./run-context.js";

/** Critical gets most of the time and the most tests, so it has to stay a short list. */
export const MAX_CRITICAL = 4;
const LOOK_MS = 90_000;
const GRACE_MS = 45_000;

const LOOK_SYSTEM = `You get about ninety seconds in a web app (often a web3 dApp, with a test wallet injected on a local fork) to map it for the explorers who come after you. Each of them takes one feature, tries its tests and looks for bugs.

1. Look around like a new user: the landing page, the main navigation, the pages where the real work happens. Connect the wallet if that unlocks the app. Don't send transactions, but do approve what a new user needs to get going (a sign-in, enabling the account, a faucet or mint for test funds) and see what it gives you: you can't tell what setup needs without it. The wallet is a throwaway test account.
2. Call note with one line each time you learn something that matters (a page and its purpose, what needs the wallet).
3. Call submit with:
   - a two-sentence summary of the app and the pages that matter.
   - setup, only when the app makes a new user do something before its core features work: sign in, mint or claim test funds from a faucet, make a first deposit. Its steps run before every test. Pick when it runs: once (the default, and whenever a step can't be repeated often, like a faucet with a limit or a sign-in that emails a code), or each (before every test, when tests use up what setup gives on a live chain and it is cheap to repeat). Say why in one short sentence. Leave setup out when the core features work right after connecting the wallet, and keep only steps you saw were needed.
   - features: what users do in the app, most important first, one per thing a user can go away happy having done (deposit, withdraw, swap, claim, borrow). Give each a tier:
     critical: what the app is for, where a bug loses a user's money or locks them out. At most ${MAX_CRITICAL}.
     important: other things that sign or move funds (faucets, approvals, housekeeping), and the balances, positions or market data users rely on.
     supporting: docs, legal, marketing, settings.
     Features must not overlap. brief says in two sentences what the feature holds and what to look out for. startPath is where it happens.
   - each feature's tests: the happy path first, then the one or two other tests most worth having (the way back out, a limit the app must enforce). Up to 3 for a critical feature, 1 or 2 for an important one, none for supporting. "Connect wallet" or "Open the page" are steps inside a test, never tests.
     You are told what the test wallet holds on the test chain. When the page shows less, the app reads balances from somewhere else: still write the test for the real action. Apart from that the wallet has only the native coin and what setup gives it, so leave out what needs more.
     When the developer lists what to test, those come first, in their wording. Use the rest of their notes too.

Tests are read by busy developers. Write them plainly:
- name: what the user does, e.g. "Deposit USDC into the vault".
- goal: one sentence.
- expected: one sentence about what the page shows at the end when it worked: final values ("Deposited shows 5 USDC"), not changes or earlier moments, and no prices or rates that move. Say "about" for amounts the page may round.
- steps: 3 to 8 short imperative steps of 3 to 7 words, at the level a user thinks ("Connect the wallet", "Enter 5 as the amount", "Click Deposit", "Approve in the wallet"). No selectors.
Use small amounts.

Never solve a CAPTCHA or bot check: call report_blocked. If the rest of the app still works, leave that page out, carry on and submit what you found.`;

const Found = z.object({
  summary: AppMap.shape.summary,
  pages: AppMap.shape.pages.describe("The pages that matter, with their purpose"),
  setup: SetupDraft.optional().describe("Steps every test needs first; leave out when there are none"),
  features: z
    .array(
      z.object({
        name: z.string().describe("Two or three words, e.g. 'Deposit'"),
        tier: Tier,
        why: z.string().describe("A few words on what put it in this tier"),
        startPath: z.string().describe("Same-origin path where it happens"),
        brief: z.string(),
        tests: z.array(TestDraft).max(3),
      }),
    )
    .min(1)
    .max(8),
});
export type Found = z.infer<typeof Found>;

export interface LookOptions {
  hints?: string;
  known?: KnownTest[];
  inbox?: Inbox;
  signal?: AbortSignal;
  onNote?: (text: string) => void;
}

export async function lookAround(session: DrillSession, llm: Llm, opts: LookOptions): Promise<{ found?: Found; blocked?: Blocked }> {
  const started = Date.now();
  const notes: string[] = [];
  let found: Found | undefined;
  let blocked: Blocked | undefined;
  const note = (text: string) => {
    notes.push(text);
    opts.onNote?.(text);
  };

  // Past the time plus a grace period the loop stops, and the notes are turned into a submission.
  const hard = new AbortController();
  const timer = setTimeout(() => hard.abort(), LOOK_MS + GRACE_MS);
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
      budgetNote: () => (Date.now() - started > LOOK_MS ? "Time is up. Call submit now with what you have." : undefined),
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
      description: "Submit the summary, the pages, the setup if any, and the features with their tests. Ends the look.",
      schema: Found,
      handler: async (input) => {
        found = input;
        return "Submitted. Stop now.";
      },
    },
  ];

  const prompt = [
    `App: ${session.target.url}`,
    await walletLine(session),
    opts.hints ? `Hints from the developer: ${opts.hints}` : "",
    opts.known?.length ? `The app already has these tests, so don't write them again:\n${opts.known.map((t) => `- ${t.name}: ${t.goal}`).join("\n")}` : "",
    "",
    "The landing page:",
    formatSnapshot(await takeSnapshot(session.page, { maxChars: 9_000 })),
  ].filter(Boolean).join("\n");

  try {
    await llm.runAgent({ system: LOOK_SYSTEM, prompt, tools, maxTurns: 40, signal });
  } catch (e) {
    if (!signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!found && !blocked && !opts.signal?.aborted && notes.length) {
    found = await llm
      .structured({ system: LOOK_SYSTEM, prompt: `${prompt}\n\nYour notes from looking around:\n${notes.map((n) => `- ${n}`).join("\n")}\n\nSubmit now.`, schema: Found, name: "submit" })
      .catch(() => undefined);
  }
  return { found: found && settleFeatures(found), blocked };
}

/** The tiers' limits in code: a short Critical list, and no tests for supporting pages. */
export function settleFeatures(found: Found): Found {
  let critical = 0;
  const seen = new Set<string>();
  const features = found.features
    .filter((f) => !seen.has(f.name.toLowerCase()) && seen.add(f.name.toLowerCase()))
    .map((f) => {
      const tier = f.tier === "critical" && ++critical > MAX_CRITICAL ? ("important" as const) : f.tier;
      return { ...f, tier, tests: tier === "supporting" ? [] : f.tests.slice(0, tier === "critical" ? 3 : 2) };
    });
  return { ...found, features };
}
