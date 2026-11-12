/**
 * Drafting a test from a goal. A model does the goal once in the browser to learn how the app does
 * it, then writes the test as sentences only: what is done, what must be true, and who does each
 * line. Nothing it clicked is kept; the runner records the actions when it proves the test.
 */
import { z } from "zod";
import { CodeAssert, RunValue, Test, urlOnApp, type Blocked } from "@dappdrill/core";
import { formatSnapshot, takeSnapshot } from "../agent/snapshot.js";
import { browserTools, inboxTool, Recorder, settle, walletLine } from "../agent/tools.js";
import { refuseOnLiveMainnet } from "../chain/controller.js";
import type { Env } from "../pipeline/env.js";
import { pin } from "../pipeline/pin.js";
import { landingBotCheck, openSession } from "../pipeline/session.js";
import type { AgentTool } from "../types.js";

const MAX_TURNS = 60;
/** Browser steps after which the walker is told to write up. */
const WRITE_UP_AFTER = 40;

/** Something the app did that a user wouldn't accept. */
export const Finding = z.object({
  what: z.string().describe("What is wrong, like a heading: “Withdraw stays disabled after a deposit”"),
  expected: z.string().describe("What a user is entitled to expect, and why: the app's own words, or the goal"),
  saw: z.string().describe("What the app did instead, with the exact text or figures"),
});
export type Finding = z.infer<typeof Finding>;

/** A line as a model writes it: one sentence, who does it, and for a code check what code looks for. */
export const DraftLine = z.object({
  type: z.enum(["action", "check"]),
  text: z.string().min(1).describe("An action: what to do, naming the control and the value as the page writes them. A check: one claim that must be true at this point"),
  by: z.enum(["code", "llm"]),
  expect: CodeAssert.optional().describe("Only for a check by code: what code looks for"),
});
export type DraftLine = z.infer<typeof DraftLine>;

const Written = z.object({
  name: z.string().min(1).describe("What the user does, in a few words: “Deposit 100 hUSDC”"),
  startPath: z.string().describe("The path of the page the test starts on"),
  values: z.array(z.object({ name: z.string().regex(/^\w+$/), ...RunValue.shape })).default([]).describe("Numbers picked afresh on every run, written {{name}} in the lines"),
  lines: z.array(DraftLine).min(2),
  cleanup: z.array(z.string()).default([]).describe("Only on an account that is kept between runs: actions that take back what the test may have left when it stopped half way"),
  notes: z.array(z.string()).max(2).default([]).describe("What you had to find out about this app that the next person writing a test for it should be told. One sentence each. Not what this test does"),
  problems: z.array(Finding).default([]).describe("Things the app did that a user wouldn't accept"),
});

export type Draft = { test: Test; notes: string[]; problems: Finding[] } | { gaveUp: string };

/** A draft line as a line of a test. A code action starts with nothing recorded. */
export function asLine(line: DraftLine): Test["steps"][number] {
  if (line.type === "action") return line.by === "code" ? { type: "action", by: "code", do: line.text, run: [] } : { type: "action", by: "llm", do: line.text };
  return line.by === "code" && line.expect ? { type: "check", by: "code", claim: line.text, expect: line.expect } : { type: "check", by: "llm", claim: line.text };
}

const SYSTEM = `You write one end-to-end test for a web app, often a web3 dApp. A test wallet is injected into the page and the user is already set up. You are given a goal: something a user wants to get done. First do it yourself in the browser, as a user would, to learn how the app does it and what it shows when it worked. Then write the test with write_test. If the app has no way to do it, or you are blocked, call give_up.

HOW A TEST IS RUN
- A test is a flat list of lines. A line is an action (something done in the browser or the wallet) or a check (one claim that must be true at that point).
- It runs in a fresh browser, as the same user, starting on the start page you name. Whatever has to happen after that page opens must be a line, including things you did early while finding your way.
- Each line is done or decided by someone who never saw what you did and reads only the sentences and the page. Name the button, field, tab and value the way the page writes them.
- When a line doesn't pass, the lines after it aren't done.

ACTIONS
- One thing a user would call one step: “Type 100 into “Amount to deposit”.” or “Click “Approve 100 hUSDC” and approve the request in the wallet.” A wallet request belongs to the action that causes it; say whether it is approved or rejected.
- by "code": the same clicks and typing do it on every run. It is recorded once and replayed with no model. Most actions are this.
- by "llm": what to click depends on what is there at the time: which rows exist, how many things are open, what an earlier run left behind. A model reads the page on every run.

CHECKS
- After each action whose effect matters, and at the end to show the goal was reached. One claim each. A test usually has three to eight.
- A check says what a user is entitled to expect, from the goal and from the app's own words: the amount asked for is the amount the wallet signs, a balance moves by what was moved, the page says it went through, the new thing is listed where the app lists such things. Don't write a check only because something happened to be on the page.
- When the app did something a user wouldn't accept (a wrong amount, a message the page contradicts, a balance that didn't move), write the check for what should be true anyway and put what you saw under problems. Never bend the test around a fault.
- Never put in a check a figure that will be different on the next run: a price, a balance, a growing count, a date, an id. Say how it moves, or tie it to a value of the test.
- by "llm" is the usual choice: a model answers the claim from the page as it is then (its text and a picture), from what the page showed during the latest action and took away again, and from what the wallet was asked. It doesn't see earlier pages. Write the claim so it can be answered from that.
- by "code" when code can read the fact exactly. Then give expect, one of:
  {kind:"signed", holds}: the wallet was asked to sign something that holds this text: a function name ("deposit("), an address, an amount.
  {kind:"not-signed", holds?}: it wasn't asked at all, or for nothing that holds this.
  {kind:"mined", holds?}: the transaction was mined and didn't revert. Use it after every action that sends one.
  {kind:"changes", figure, by, on?}: the number under or beside a label moved by this much since the test began (by: -100, or "-{{amount}}"). figure is the label exactly as the page writes it. It must be readable when the test starts: on the start page, or on the page whose path you give as on. A check with on opens that page and leaves the browser there, so such checks come last.
  {kind:"said", text}: a notice that shows for a moment and goes (a toast). The text is a part of it that is the same on every run.
  {kind:"shows", text} / {kind:"hides", text}: text that is on the page now, the same on every run.
  {kind:"button", name, is}: a button is "enabled" or "disabled".
  {kind:"url", contains}.

VALUES
- A number the test types can be a value: a range, picked afresh on every run, written {{name}} wherever the lines use it (“Type {{amount}} into Amount”, by: "-{{amount}}"). On an account that is kept between runs, use one for amounts and prices, so this run's order or transfer can be told from those of earlier runs; a figure the goal names is then the size to aim for (“a limit order at $300” becomes a price picked between 290 and 310), not the one figure every run must use. On a chain that is reset before every run a fixed number is fine.

NOTES AND PROBLEMS
- notes: only what the next test for this app will need and couldn't see for itself on the page: something that tripped you, an order things have to be done in, a fault that is in the way. Not what the page plainly shows, not how the app behaves when all goes well, not what this test does, not a note you were given. Most tests add none.
- problems: faults of the app, with the exact text or figures.

IN THE BROWSER
- Use the page as a user would: look, click, type, select. Prefer what is visible over guessing URLs.
- Wallet requests show up in tool results. Approve what the goal needs with wallet_approve; a request the goal doesn't need, reject.
- A first-visit prompt in the way (terms, cookies, a tour): accept or close it.
- Never solve a CAPTCHA or bot check: call report_blocked, then give_up. The same when the app refuses this user or wallet.
- A click that fails tells you nothing about the app. Look again and try another element with the same name.
- Don't wander. Do the goal once, look at what shows it worked, write the test.`;

const FORKED = `The chains are local copies: what you do now is undone before the test runs, and before every run of it.`;
const KEPT = `The account is on a live chain and keeps everything: what you do now stays, and so does what every run of the test does. So:
- Do the goal with small amounts.
- The test ends with the account as it found it: after its last check come the actions that take back what it made (cancel the order, close the position, withdraw the deposit). Do the same yourself before you write the test.
- cleanup says how to take things back when the test stopped half way, in words that work whatever state it stopped in (“Cancel every open order for …”).
- Earlier runs have left history behind (orders, transfers). A check must be about what this run made: name the value it used.`;

export interface DraftInput {
  goal: string;
  /** Where the walker begins. It may name another start page for the test. */
  startPath: string;
  /** Where the setup left the browser. */
  storageState?: string;
  /** What is known about the app. */
  notes: string[];
  /** Names of the tests the app already has. */
  existing: string[];
  artifactsDir: string;
  signal?: AbortSignal;
}

export async function draftTest(env: Env, input: DraftInput): Promise<Draft> {
  const revert = await pin(env);
  const session = await openSession(env, input.artifactsDir, undefined, { storageState: input.storageState });
  try {
    await session.page.goto(urlOnApp(input.startPath, env.target.url), { waitUntil: "domcontentloaded" });
    const block = await landingBotCheck(session);
    if (block) return { gaveUp: `Blocked: ${block.reason}` };
    await settle(session);

    const recorder = new Recorder(session);
    let blocked: Blocked | undefined;
    let out: Draft | undefined;
    let steps = 0;
    const tools: AgentTool[] = [
      ...browserTools({
        session,
        recorder,
        inbox: env.inbox,
        onBlocked: (b) => (blocked = b),
        refuseApprove: (r) => refuseOnLiveMainnet(env.chains, r),
        budgetNote: () => (++steps >= WRITE_UP_AFTER ? "You have taken many steps. Write the test now with write_test, or call give_up." : undefined),
      }),
      ...(env.inbox ? [inboxTool(env.inbox)] : []),
      {
        name: "write_test",
        description: "Write the test. Call it once, when you have done the goal and seen what shows it worked.",
        schema: Written,
        handler: async (written) => {
          const made = asTest(written, input.goal);
          if ("wrong" in made) return `Not taken: ${made.wrong} Call write_test again with that put right.`;
          out = { test: made.test, notes: written.notes, problems: written.problems };
          return "Taken. Stop now.";
        },
      },
      {
        name: "give_up",
        description: "The goal can't be done here: the app has no way to do it, refuses this user, or is blocked.",
        schema: z.object({ why: z.string().describe("One sentence, with the app's own words when it said something") }),
        handler: async ({ why }) => {
          out = { gaveUp: why };
          return "Recorded. Stop now.";
        },
      },
    ];

    const live = env.chains.configs().some((c) => c.mode === "live");
    const prompt = [
      `Goal: ${input.goal}`,
      "",
      live ? KEPT : FORKED,
      await walletLine(session),
      input.notes.length ? `\nWhat is known about this app:\n${input.notes.map((n) => `- ${n}`).join("\n")}` : "",
      input.existing.length ? `\nTests it already has (write a different one):\n${input.existing.map((n) => `- ${n}`).join("\n")}` : "",
      "",
      `You are on ${input.startPath}. The page now:`,
      formatSnapshot(await takeSnapshot(session.page, { maxChars: 9_000 })),
    ].filter((l) => l !== undefined).join("\n");

    const res = await env.fastLlm().runAgent({ system: SYSTEM, prompt, tools, maxTurns: MAX_TURNS, signal: input.signal });
    if (out) return out;
    if (blocked) return { gaveUp: `Blocked: ${(blocked as Blocked).reason}` };
    return { gaveUp: res.stopReason === "max_turns" ? "Ran out of steps before the test was written." : `Stopped without writing a test: ${res.text.slice(0, 200)}` };
  } finally {
    await session.close();
    await revert();
  }
}

/** The test a model wrote, or what is wrong with it in words it can act on. */
export function asTest(written: z.infer<typeof Written>, goal: string): { test: Test } | { wrong: string } {
  const { lines } = written;
  const noExpect = lines.findIndex((l) => l.type === "check" && l.by === "code" && !l.expect);
  if (noExpect >= 0) return { wrong: `Line ${noExpect + 1} is a check by code with no expect.` };
  if (!lines.some((l) => l.type === "action")) return { wrong: "There is no action." };
  if (!lines.some((l) => l.type === "check")) return { wrong: "There is no check." };
  const parsed = Test.safeParse({
    id: written.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "test",
    name: written.name,
    goal,
    startPath: written.startPath,
    values: Object.fromEntries(written.values.map(({ name, ...range }) => [name, range])),
    steps: lines.map(asLine),
    cleanup: written.cleanup.map((text) => ({ type: "action", by: "llm", do: text })),
  });
  if (!parsed.success) return { wrong: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const wrong = wrongValues(parsed.data);
  return wrong ? { wrong } : { test: parsed.data };
}

/** What is wrong with a test's values, if anything: a range backwards, a name used and not given, or given and not used. */
export function wrongValues(test: Test): string | undefined {
  const backwards = Object.entries(test.values).find(([, v]) => v.from > v.to);
  if (backwards) return `The value ${backwards[0]} runs from ${backwards[1].from} to ${backwards[1].to}.`;
  const used = new Set([...JSON.stringify([test.steps, test.cleanup]).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!));
  const unknown = [...used].find((n) => !(n in test.values));
  if (unknown) return `{{${unknown}}} is used but isn't among the values.`;
  const unused = Object.keys(test.values).find((n) => !used.has(n));
  if (unused) return `The value ${unused} is never used: write {{${unused}}} where the lines type or name it.`;
  return undefined;
}
