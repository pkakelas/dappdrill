/**
 * The analysis: a short look around the app to learn what it is, which pages
 * matter, and the two or three things its users most need to work. Each
 * becomes a flow with one happy-path test in plain English; nothing is
 * recorded here, the first run of each test does that.
 */
import { z } from "zod";
import { AppMap, FlowDraft, describeBlock, type Blocked } from "@dappdrill/core";
import type { AgentTool, DrillSession, Inbox, Llm } from "../types.js";
import { formatSnapshot, takeSnapshot } from "./snapshot.js";
import { browserTools, inboxTool, Recorder } from "./tools.js";

export const ANALYZE_SYSTEM = `You get about two minutes in a web app (often a web3 dApp, with a test wallet injected on a local fork) to learn it and pick what to test.

1. Look around like a new user: the landing page, the main navigation, the pages where the real work happens. Connect the wallet if that unlocks the app. Don't send transactions.
2. Call note with one line each time you learn something that matters (a page and its purpose, what needs the wallet).
3. Call submit with:
   - a two-sentence summary of the app and the pages that matter,
   - the 2 or 3 flows users most need to work (the app's core value: trade, swap, deposit, mint, borrow), each with one happy-path test.

Tests are read by busy developers. Write them plainly:
- name: what the user does, e.g. "Market buy on ETH perp".
- goal: one sentence.
- expected: one sentence about what is visible when it worked.
- steps: 3 to 8 short imperative steps of 3 to 7 words, at the level a user thinks ("Connect the wallet", "Open the ETH market", "Enter 0.01 as size", "Click Buy", "Approve in the wallet", "Check the order in Positions"). No selectors, no refs.
Use small amounts. Skip docs, socials, settings and anything that leaves the app.

Never solve a CAPTCHA or bot check: call report_blocked.`;

const Submission = z.object({
  summary: AppMap.shape.summary,
  pages: AppMap.shape.pages.describe("The pages that matter, with their purpose"),
  flows: z.array(FlowDraft).min(1).max(3),
});
type Submission = z.infer<typeof Submission>;

export interface AnalyzeOptions {
  /** Time to look around before submitting (default 120s). */
  maxMs?: number;
  /** Free-text hints from the user ("the swap page is under /trade"). */
  hints?: string;
  inbox?: Inbox;
  signal?: AbortSignal;
  /** A line for the live log. */
  onNote?: (text: string) => void;
}

export interface AnalyzeResult {
  map?: AppMap;
  flows: FlowDraft[];
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
      description: "Submit the summary, the pages that matter and 2-3 flows with their happy-path tests. Ends the analysis.",
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
    opts.hints ? `Hints from the developer: ${opts.hints}` : "",
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
  if (blocked) return { flows: [], blocked };
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
  if (!submitted) return { flows: [] };
  return { map: { summary: submitted.summary, pages: submitted.pages }, flows: submitted.flows };
}
