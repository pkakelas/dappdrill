/**
 * The look: a minute or two in the app to learn what it is, what a new user has to do first, and
 * which features it has. Each feature comes back with the tests worth having, which explorers
 * then try. Nothing is saved from here: a suggested test still has to prove itself.
 */
import type { Frame, Page } from "playwright";
import { z } from "zod";
import { AppMap, SetupDraft, TestDraft, Tier, describeBlock, type Blocked } from "@dappdrill/core";
import { formatSnapshot, takeSnapshot } from "../agent/snapshot.js";
import { walletLine } from "../agent/tester.js";
import { browserTools, inboxTool, noteTool, Recorder } from "../agent/tools.js";
import type { AgentTool, DrillSession, Inbox, Llm } from "../types.js";
import { fundTool, type WalletToken } from "./funding.js";
import type { KnownTest } from "./run-context.js";

/** Critical gets most of the time and the most tests, so it has to stay a short list. */
export const MAX_CRITICAL = 4;
const LOOK_MS = 90_000;
/** Each page the app links to buys the look a little longer, up to this. */
const LOOK_MAX_MS = 210_000;
const PER_PAGE_MS = 15_000;
/** Writing the submission takes the model about a minute, and cutting it off means writing it again from the notes. */
const GRACE_MS = 90_000;

const LOOK_SYSTEM = `You get a couple of minutes in a web app (often a web3 dApp, with a test wallet injected on a local fork) to map it for the explorers who come after you. Each of them takes one feature, tries its tests and looks for bugs.

1. Look around like a new user: the landing page, the main navigation, the pages where the real work happens. You are told which pages the app links to. Open each one that could hold something a user does, since an app's second-biggest feature is often one link away; submit is refused once while such a page is still unopened. Tabs and menus inside a page count too. Connect the wallet if that unlocks the app. Don't send transactions, but do approve what a new user needs to get going (a sign-in, enabling the account, a faucet or mint for test funds) and see what it gives you: you can't tell what setup needs without it. The wallet is a throwaway test account.
   When the app's main action needs a token the wallet doesn't hold (USDC to deposit, a token to sell), call fund_wallet as soon as you see it, reload, and carry on with a wallet that can do the real thing. Tests of the real action are worth far more than tests of an empty wallet's error messages.
2. Call note each time you learn something that matters (a page and its purpose, what needs the wallet). People watch the titles come in, so write each like a heading of 3 to 7 words ("Swap and bridge on the landing page", "Wallet connects without signing") and put the specifics in detail, which only you see.
3. Call submit with:
   - a two-sentence summary of the app and the pages that matter.
   - setup, only when the app makes a new user do something before its core features work: sign in, mint or claim test funds from a faucet, make a first deposit. Its steps run before every test. Pick when it runs: once (the default, and whenever a step can't be repeated often, like a faucet with a limit or a sign-in that emails a code), or each (before every test, when tests use up what setup gives on a live chain and it is cheap to repeat). Say why in one short sentence. Leave setup out when the core features work right after connecting the wallet, and keep only steps you saw were needed.
   - features: what users do in the app, most important first, one per thing a user can go away happy having done (deposit, withdraw, swap, claim, borrow). Give each a tier:
     critical: what the app is for, where a bug loses a user's money or locks them out. At most ${MAX_CRITICAL}.
     important: other things that sign or move funds (faucets, approvals, housekeeping), and the balances, positions or market data users rely on.
     supporting: docs, legal, marketing, settings.
     Features must not overlap. brief says in two sentences what the feature holds and what to look out for. startPath is where it happens.
   - each feature's tests: the happy path first, then the one or two other tests most worth having (the way back out, a limit the app must enforce). Up to 3 for a critical feature, 1 or 2 for an important one, none for supporting. "Connect wallet" or "Open the page" are steps inside a test, never tests.
     You are told what the test wallet holds on the test chain. When the page shows less, the app reads balances from somewhere else: still write the test for the real action. Apart from that the wallet has only the native coin, what setup gives it and what you fund, so leave out what needs more.
     Every test starts on a fresh copy of the chain, after setup and nothing else. One that needs a deposit or an open position makes it in its own steps ("Withdraw the deposit" begins by depositing), even when the app's servers remember one from before. Only that copy sees the wallet's transactions, so a transfer to another chain never arrives: expect the page to show it as sent or in progress, not as received.
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
    .max(10),
});
export type Found = z.infer<typeof Found>;

export interface LookOptions {
  hints?: string;
  known?: KnownTest[];
  inbox?: Inbox;
  signal?: AbortSignal;
  onNote?: (text: string) => void;
  /** A token was put in the test wallet. */
  onFunded?: (token: WalletToken, line: string) => void;
}

export async function lookAround(session: DrillSession, llm: Llm, opts: LookOptions): Promise<{ found?: Found; blocked?: Blocked }> {
  const started = Date.now();
  const notes: string[] = [];
  let found: Found | undefined;
  let blocked: Blocked | undefined;
  // The title is what people watch; the detail stays here for the summary if time runs out.
  const note = (title: string, detail?: string) => {
    notes.push(detail ? `${title}: ${detail}` : title);
    opts.onNote?.(title);
  };

  // Which pages the app links to, and which of them were opened: the look isn't over while one that matters wasn't.
  const { page } = session;
  const pages = new SitePages(session.target.url);
  const collect = () => linkedPages(page).then((links) => pages.link(links), () => {});
  const onNavigated = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    pages.open(frame.url());
    // Links arrive after the route renders.
    setTimeout(() => void collect(), 1_500);
  };
  pages.open(page.url());
  await collect();
  page.on("framenavigated", onNavigated);
  const lookMs = Math.min(LOOK_MAX_MS, LOOK_MS + pages.unopened().length * PER_PAGE_MS);
  let audited = false;

  // Past the time plus a grace period the loop stops, and the notes are turned into a submission.
  const hard = new AbortController();
  const timer = setTimeout(() => hard.abort(), lookMs + GRACE_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, hard.signal]) : hard.signal;

  const tools: AgentTool[] = [
    ...browserTools({
      session,
      recorder: new Recorder(session),
      inbox: opts.inbox,
      onBlocked: (b) => {
        blocked = b;
        note(describeBlock(b), b.reason);
      },
      budgetNote: () => (Date.now() - started > lookMs ? "Time is up. Call submit now with what you have." : undefined),
    }),
    ...(opts.inbox ? [inboxTool(opts.inbox)] : []),
    noteTool(note),
    fundTool(session, (token, line) => {
      note(line);
      opts.onFunded?.(token, line);
    }),
    {
      name: "submit",
      description: "Submit the summary, the pages, the setup if any, and the features with their tests. Ends the look.",
      schema: Found,
      handler: async (input) => {
        await collect();
        const missed = pages.unopened();
        if (missed.length && !audited && Date.now() - started < lookMs) {
          audited = true;
          return `Not submitted yet. The app links to pages you haven't opened:\n${missed.map((p) => `- ${p}`).join("\n")}\nOpen the ones that could hold a feature, add what you find, and submit again. Submit again as it is if none of them can.`;
        }
        found = input;
        return "Submitted. Stop now.";
      },
    },
  ];

  const prompt = [
    `App: ${session.target.url}`,
    await walletLine(session),
    opts.hints ? `Hints from the developer: ${opts.hints}` : "",
    pages.unopened().length ? `Pages the landing page links to:\n${pages.unopened().map((p) => `- ${p}`).join("\n")}` : "",
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
    page.off("framenavigated", onNavigated);
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

/** Pages that seldom hold anything a user does in the app. */
const ASIDE = /^\/(terms|tos|privacy|legal|cookies?|docs?|blog|news|faq|help|support|about|careers|jobs|press|brand|media)(\/|$)/i;
const FILE = /\.(pdf|png|jpe?g|svg|gif|webp|zip|json|xml|txt|csv)$/i;
/** Lists (markets, tokens, pools) link to one page per row; a few stand for the rest. */
const PER_PARENT = 2;

/** The same-origin pages an app links to, and which of them a visitor has opened. */
export class SitePages {
  private readonly origin: string;
  private readonly linked = new Map<string, string>();
  private readonly opened = new Set<string>();

  constructor(appUrl: string) {
    this.origin = new URL(appUrl).origin;
  }

  private path(url: string): string | undefined {
    try {
      const u = new URL(url, this.origin);
      if (u.origin !== this.origin || FILE.test(u.pathname)) return undefined;
      return u.pathname.replace(/\/+$/, "") || "/";
    } catch {
      return undefined;
    }
  }

  open(url: string): void {
    const p = this.path(url);
    if (p) this.opened.add(p);
  }

  link(links: { href: string; text: string }[]): void {
    for (const l of links) {
      const p = this.path(l.href);
      if (p && !this.linked.has(p)) this.linked.set(p, l.text);
    }
  }

  /** Linked pages nobody opened, as "/path (link text)", leaving out legal and docs pages and all but a few rows of a list. */
  unopened(): string[] {
    const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
    const seen = new Map<string, number>();
    // A row of a list that was opened stands for its siblings.
    for (const p of this.opened) if (parent(p) !== "/") seen.set(parent(p), PER_PARENT);
    const out: string[] = [];
    for (const [p, text] of this.linked) {
      if (this.opened.has(p) || ASIDE.test(p)) continue;
      const n = seen.get(parent(p)) ?? 0;
      if (parent(p) !== "/") seen.set(parent(p), n + 1);
      if (parent(p) !== "/" && n >= PER_PARENT) continue;
      out.push(text ? `${p} (${text})` : p);
    }
    return out.slice(0, 12);
  }
}

async function linkedPages(page: Page): Promise<{ href: string; text: string }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .filter((a) => !a.target || a.target === "_self")
      .map((a) => ({ href: a.href, text: (a.getAttribute("aria-label") ?? a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40) })),
  );
}
