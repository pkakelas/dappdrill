/**
 * The look: a few minutes in an app as its set-up user, to list what is worth a test. It reads and
 * clicks around and signs nothing. Each goal it comes back with is a sentence for the test maker.
 */
import path from "node:path";
import { z } from "zod";
import { urlOnApp, type Blocked, type DrillEventSink, type LineResult } from "@dappdrill/core";
import { formatSnapshot, takeSnapshot } from "../agent/snapshot.js";
import { browserTools, Recorder, settle, walletLine } from "../agent/tools.js";
import { followPages } from "../browser/site-pages.js";
import { pin } from "../pipeline/pin.js";
import { landingBotCheck, openSession } from "../pipeline/session.js";
import { openSuite, type RunSuiteInput } from "../run/suite.js";
import type { AgentTool } from "../types.js";

const MAX_TURNS = 50;
/** Browser steps after which the look is told to write up. */
const WRITE_UP_AFTER = 30;
export const MAX_GOALS = 12;

export const Goal = z.object({
  goal: z.string().min(1).describe("One sentence: who the user is, what they do and how it ends. “A user with hUSDC in the wallet deposits 100 of it into the vault.”"),
  startPath: z.string().describe("The path of the page where it is done"),
  why: z.string().describe("A few words on what a user loses when this is broken"),
});
export type Goal = z.infer<typeof Goal>;

const Seen = z.object({
  summary: z.string().describe("Two sentences: what the app is for and where the work happens"),
  goals: z.array(Goal).min(1).describe("Most important first"),
  notes: z.array(z.string()).max(5).default([]).describe("What whoever writes the tests should be told about this app. One sentence each"),
});

export interface Looked {
  summary?: string;
  goals: Goal[];
  notes: string[];
  /** Why there are no goals. */
  why?: string;
  setup?: LineResult[];
  costUsd: number;
  durationMs: number;
}

const SYSTEM = `You get a few minutes in a web app, often a web3 dApp, to list what is worth testing in it. A test wallet is injected into the page and the user is already set up. For each thing a user comes to this app to get done you write one goal: a sentence that someone else turns into an end-to-end test by doing it in the browser.

LOOKING
- Look like a user: the page you start on, the navigation, the pages where the work is done, the tabs and menus inside them. You are told which pages the app links to. Open each one that could hold something a user does: an app's second-biggest feature is often one link away.
- You sign nothing. Every wallet request is refused. Open a form and fill it in to see what it asks for and what it says, and stop there: what lies past a signature is for the tests.
- A first-visit prompt in the way (terms, cookies, a tour): accept or close it.
- Never solve a CAPTCHA or bot check: call report_blocked. If the rest of the app still works, leave that page out and carry on.
- Don't wander. A few steps on each page, then submit.

GOALS
- One for each thing a user can go away having done: “A user with hUSDC in the wallet deposits 100 of it into the vault.” Say who the user is (what they hold, what they did before), what they do and how it ends, in the app's own words for its things. Name small amounts next to what the user holds, and leave the user's own balances out of the sentence: they will have moved by the time the test is written.
- Most important first. What the app is for, where a fault costs a user money or locks them out. Then the way back out of each (withdraw, cancel, close, revoke). Then what the app has to refuse (more than the balance, under a minimum) and what a user is told when they say no in the wallet. Then the lesser things that sign.
- A goal stands alone. Its test starts as the set-up user and nothing else, so one that needs a deposit says so (“A user with 100 hUSDC in the vault takes 40 of it back.”) and the test makes that deposit itself.
- Only what this user can do with what they hold, as the app shows it. Leave out what needs more.
- Connecting the wallet, opening a page and reading the docs are not goals. Neither is a page that only shows things, unless users rely on its figures; then the goal is that the figures agree with each other or with what the user did.
- At most ${MAX_GOALS}. Leave out what the app's tests already cover.

NOTES
- Only what a test writer will need and couldn't see for themselves on the page: an order things have to be done in, something that is in the way, where a thing is hidden. Usually one or two, often none.`;

export async function lookForGoals(input: RunSuiteInput, sink: DrillEventSink = () => {}, say: (text: string) => void = () => {}): Promise<Looked> {
  const t0 = Date.now();
  const { suite } = input;
  const open = await openSuite(input, sink);
  const { env } = open;
  const done = (more: Partial<Looked>): Looked => ({ goals: [], notes: [], setup: open.setup, ...more, costUsd: env.costUsd(), durationMs: Date.now() - t0 });
  try {
    if (open.stuck) return done({ why: open.stuck });
    // Nothing is signed, but an app can change a fork without the wallet (a faucet its server pays).
    const revert = await pin(env);
    const session = await openSession(env, path.join(input.artifactsDir, "look"), undefined, { storageState: open.opts.storageState });
    try {
      await session.page.goto(urlOnApp("/", env.target.url), { waitUntil: "domcontentloaded" });
      const block = await landingBotCheck(session);
      if (block) return done({ why: `Blocked: ${block.reason}` });
      await settle(session);
      const site = await followPages(session.page, env.target.url);

      let seen: z.infer<typeof Seen> | undefined;
      let blocked: Blocked | undefined;
      let steps = 0;
      let audited = false;
      const tools: AgentTool[] = [
        ...browserTools({
          session,
          recorder: new Recorder(session),
          onBlocked: (b) => (blocked = b),
          refuseApprove: () => "Refused: nothing is signed while looking around. Reject it and carry on.",
          budgetNote: () => (++steps >= WRITE_UP_AFTER ? "You have taken many steps. Call submit now with what you have." : undefined),
        }),
        {
          name: "submit",
          description: "Hand in the goals and the notes. Ends the look.",
          schema: Seen,
          handler: async (input) => {
            await site.collect();
            const missed = site.pages.unopened();
            if (missed.length && !audited && steps < WRITE_UP_AFTER) {
              audited = true;
              return `Not taken yet. The app links to pages you haven't opened:\n${missed.map((p) => `- ${p}`).join("\n")}\nOpen the ones that could hold something a user does, add what you find and submit again. Submit again as it is if none of them can.`;
            }
            seen = input;
            return "Taken. Stop now.";
          },
        },
      ];

      const linked = site.pages.unopened();
      const prompt = [
        `App: ${env.target.url}`,
        await walletLine(session),
        env.chains.configs().some((c) => c.mode === "live") ? "The account is on a live chain and keeps what earlier runs left: what you see may hold their orders and transfers." : "",
        suite.notes.length ? `\nWhat is known about this app:\n${suite.notes.map((n) => `- ${n.text}`).join("\n")}` : "",
        suite.tests.length ? `\nTests it already has:\n${suite.tests.map((t) => `- ${t.name}: ${t.goal}`).join("\n")}` : "",
        linked.length ? `\nPages this page links to:\n${linked.map((p) => `- ${p}`).join("\n")}` : "",
        "",
        "The page now:",
        formatSnapshot(await takeSnapshot(session.page, { maxChars: 9_000 })),
      ].join("\n");

      say("Looking around");
      try {
        await env.thinkLlm().runAgent({ system: SYSTEM, prompt, tools, maxTurns: MAX_TURNS, signal: input.signal });
      } finally {
        site.stop();
      }
      if (!seen) return done({ why: blocked ? `Blocked: ${blocked.reason}` : "The look ended without a list of goals." });
      const known = new Set(suite.notes.map((n) => n.text));
      return done({ summary: seen.summary, goals: seen.goals.slice(0, MAX_GOALS), notes: seen.notes.filter((n) => !known.has(n)) });
    } finally {
      await session.close();
      await revert();
    }
  } finally {
    await open.close();
  }
}
