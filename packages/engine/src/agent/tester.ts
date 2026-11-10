/**
 * Runs one plain-English test step. Cached actions from the last passing run
 * replay first; when they break, or there are none, the fast model does the
 * step with the browser tools and its actions become the new cache. A step
 * the fast model can't settle goes to the acting model once.
 */
import { formatEther } from "viem";
import { z } from "zod";
import { describeStep, forkBlindLine, type AppMap, type Blocked, type Step, type TestSpec, type WalletRequest } from "@dappdrill/core";
import type { AgentTool, DrillSession, Hex, Inbox, Llm } from "../types.js";
import { formatSnapshot, takeSnapshot } from "./snapshot.js";
import { browserTools, inboxTool, Recorder, settle } from "./tools.js";
import { openDialog } from "../replay/locators.js";
import { unpaid as unpaidBy } from "../wallet/errors.js";
import { decodeWalletRequest } from "./wallet-decode.js";

const FAST_TURNS = 14;
const STRONG_TURNS = 20;

const STEP_SYSTEM = `You carry out one step of an end-to-end test on a web app (often a web3 dApp with an injected test wallet).
You get the test's goal, all its steps, and the one step to do now. Do only that step, with as few actions as you can. If an earlier step's work is still queued or unfinished on the page, finish it first: the steps assume it was done.

- Use the page as a user would: look, click, type, select. Prefer what is visible over guessing URLs.
- When the step is already true (the wallet is already connected, the page is already open), do nothing and call step_done. That is for state you can see, not for an action: a step that says to click, enter or sign something is done when you did it. A disabled Save, Confirm or Submit button means something the step needs hasn't taken (a value went to the wrong field, an earlier click didn't land): put the step's inputs in place again, in the dialog or panel that is open, and then click it. Don't go and check the result instead; if it stays disabled, the step didn't work (ok=false, cause "app", with what the page says).
- The browser is new, so the app may put a first-visit prompt in the way that the steps don't mention: terms to accept, a cookie banner, a welcome tour. Accept or close it as part of your step, marked optional, as soon as it shows or the page says it is waiting for it ("Accept the terms to continue").
- Wallet requests show up in tool results. Approve them with wallet_approve unless the step says to reject.
- When the step asks to check something, confirm it on the page and call expect_text with a short exact text that proves it. A value within 1% is the same value: apps round and truncate (0.0099 for 0.01).
- Never solve a CAPTCHA or bot check. Call report_blocked. Do the same when the app refuses this user or wallet ("access unavailable", a region block); don't try to get around it.
- A click that fails tells you nothing about the app. Look again with a screenshot and try another element with the same name.
- Only report what you saw. A wallet request that returned an empty list means nothing is connected.
- Finish with step_done. ok=false with cause "app" when a user would see the app in the way (an error, a disabled button, missing content); cause "unsure" when you couldn't work out how to do the step.
- You are told what the wallet holds on the test chain. When that is what stops the step because the page shows something else (0 ETH while it holds 100), use cause "fork": the app is reading from somewhere other than the test chain.`;

export interface StepDeps {
  session: DrillSession;
  fast: Llm;
  /** Gets the step once when the fast model runs out of turns or isn't sure. */
  strong?: Llm;
  map?: AppMap;
  inbox?: Inbox;
  /** Replays cached actions from where the page is now. */
  replay: (actions: Step[]) => Promise<{ ok: boolean; error?: string }>;
  beforeApprove?: (request: WalletRequest) => Promise<void>;
  /** Backends the page told about the wallet. */
  walletBackends?: () => string[];
  signal?: AbortSignal;
}

export interface StepOutcome {
  ok: boolean;
  via: "cache" | "agent";
  /** One line per action taken. */
  did: string[];
  note?: string;
  /** The actions to cache for next time; set when the agent passed the step. */
  actions?: Step[];
  blocked?: Blocked;
  /** We couldn't click our way through, so the step says nothing about the app: the run is Couldn't run, not Failed. */
  stuck?: boolean;
}

export async function runStep(deps: StepDeps, test: TestSpec, index: number): Promise<StepOutcome> {
  const step = test.steps[index]!;
  let broke: string | undefined;
  if (step.actions) {
    const r = await deps.replay(step.actions);
    if (r.ok) return { ok: true, via: "cache", did: step.actions.map(describeStep) };
    broke = r.error;
  }

  const asked = deps.session.wallet.requests().length;
  const recorder = new Recorder(deps.session);
  recorder.start(step.text);
  let blocked: Blocked | undefined;
  /** What the latest click failed to reach, until a later click lands. */
  let stuckOn: string | undefined;
  const hooks: AttemptHooks = { onBlocked: (b) => (blocked = b), onClick: (failed) => (stuckOn = failed) };
  const fast = await attempt(deps.fast, FAST_TURNS, deps, test, index, recorder, hooks, broke);
  let done = fast.done;
  // The fast model tends to blame the app for a click of ours that failed, so that goes to the acting model too.
  if (done && !done.ok && stuckOn) done.cause = "unsure";
  // The model's word alone doesn't excuse a wrong balance: a backend must really have been asked about the wallet.
  const blindTo = () => (done && !done.ok && done.cause === "fork" ? (deps.walletBackends?.() ?? []) : []);
  // Our wallet not being able to pay says nothing about the app, and a retry can't change it.
  const { wallet, chains } = deps.session;
  const unpaid = () => {
    for (const r of wallet.requests().slice(asked)) {
      const why = unpaidBy(r, wallet.address(), chains.has(r.chainId) && chains.mode(r.chainId) === "live");
      if (why) return why;
    }
    return undefined;
  };
  // A step that has never worked is more likely our misreading than the app's fault, whatever the fast model says.
  if (!blocked && !blindTo().length && !unpaid() && deps.strong && (!done || (!done.ok && (done.cause === "unsure" || !step.actions)))) {
    const hint = done ? `A quicker attempt gave up: ${done.reason}` : "A quicker attempt ran out of actions before finishing.";
    done = (await attempt(deps.strong, STRONG_TURNS, deps, test, index, recorder, hooks, broke, hint)).done;
  }
  const actions = recorder.take();
  const did = actions.map(describeStep);
  if (blocked) return { ok: false, via: "agent", did, note: `Blocked: ${blocked.reason}`, blocked };
  const noKey = done?.ok ? undefined : unpaid();
  if (noKey) return { ok: false, via: "agent", did, note: noKey, stuck: true };
  const hosts = blindTo();
  if (done && hosts.length) return { ok: false, via: "agent", did, note: forkBlindLine(done.reason, hosts), stuck: true };
  if (stuckOn && !done?.ok && done?.cause !== "app") return { ok: false, via: "agent", did, note: `Couldn't click “${stuckOn}”, so this step didn't finish.`, stuck: true };
  if (!done) return { ok: false, via: "agent", did, note: "Couldn't finish this step." };
  return { ok: done.ok, via: "agent", did, note: done.reason || undefined, actions: done.ok ? actions : undefined };
}

interface Done {
  ok: boolean;
  cause?: "app" | "unsure" | "fork";
  reason: string;
}

interface AttemptHooks {
  onBlocked: (b: Blocked) => void;
  onClick: (failed?: string) => void;
}

async function attempt(
  llm: Llm,
  maxTurns: number,
  deps: StepDeps,
  test: TestSpec,
  index: number,
  recorder: Recorder,
  hooks: AttemptHooks,
  broke?: string,
  hint?: string,
): Promise<{ done?: Done }> {
  const { session } = deps;
  let done: Done | undefined;
  const tools: AgentTool[] = [
    ...browserTools({ session, recorder, inbox: deps.inbox, ...hooks, beforeApprove: deps.beforeApprove }),
    ...(deps.inbox ? [inboxTool(deps.inbox)] : []),
    {
      name: "expect_text",
      description: "Check that a short exact text is visible on the page now. Records it as a check that later runs repeat, so use text that will read the same next time: amounts the test typed and labels, never prices, rates, USD values or times.",
      schema: z.object({ text: z.string().min(1).max(80) }),
      handler: async ({ text }) => {
        const visible = await session.page.getByText(text).first().isVisible().catch(() => false);
        if (!visible) return `"${text}" is not visible. Look again and use text exactly as shown, or call step_done with ok=false.`;
        recorder.add({ kind: "expect", assert: { type: "visible", text } });
        return `Seen: "${text}".`;
      },
    },
    {
      name: "step_done",
      description: "Finish the step. Call it exactly once.",
      schema: z.object({
        ok: z.boolean(),
        cause: z.enum(["app", "unsure", "fork"]).optional().describe("When ok=false: app = the app is broken or in the way; unsure = you couldn't work it out; fork = the page disagrees with what the wallet holds on the test chain"),
        reason: z.string().describe("One short sentence: what happened, or what's wrong. When the app shows an error, give its own words (\"User limit reached\") and where they came from if you can tell (the app, its sign-in provider, the wallet)"),
      }),
      handler: async (input) => {
        done = input;
        return "Recorded. Stop now.";
      },
    },
  ];

  await settle(session);
  const snap = formatSnapshot(await takeSnapshot(session.page, { maxChars: 9_000 }));
  const prompt = [
    deps.map ? `About the app: ${deps.map.summary}\nPages:\n${deps.map.pages.map((p) => `- ${p.path}: ${p.purpose}`).join("\n")}\n` : "",
    `Test: ${test.name}`,
    `Goal: ${test.goal}`,
    `Expected: ${test.expected}`,
    await walletLine(session),
    "Steps:",
    ...test.steps.map((s, i) => `${i + 1}. ${s.text}${i < index ? "  (done)" : i === index ? "  ← do this one now" : ""}`),
    broke ? `\nLast time this step worked with recorded actions, but replaying them failed now: ${broke}` : "",
    hint ? `\n${hint}` : "",
    "",
    "The page now:",
    snap,
  ].filter(Boolean).join("\n");

  const res = await llm.runAgent({ system: STEP_SYSTEM, prompt, tools, maxTurns, signal: deps.signal });
  return { done: done ?? (res.stopReason === "end_turn" && res.text ? { ok: false, cause: "unsure", reason: res.text.slice(0, 200) } : undefined) };
}

/** Says when tests will run on the real chain, so the writer gives them cleanup steps. Empty on forks. */
export function liveLine(session: Pick<DrillSession, "chains">): string {
  const live = session.chains.configs().filter((c) => c.mode === "live");
  if (live.length === 0) return "";
  const names = live.map((c) => c.name ?? `chain ${c.id}`).join(" and ");
  return `${names} can't be forked, so tests run on the live network with one account that keeps what every run leaves behind. A test that leaves an order, a deposit or a position open gets "after" steps that put it back.`;
}

export async function walletLine(session: DrillSession): Promise<string> {
  try {
    const address = session.wallet.address();
    const wei = await session.chains.client(session.wallet.chainId()).getBalance({ address });
    return `The test wallet ${address} holds ${formatEther(wei)} of the native coin on the test chain.`;
  } catch {
    return "";
  }
}

const Verdict = z.object({
  ok: z.boolean().describe("true when the page shows the expected result"),
  reason: z.string().describe("One short sentence naming what shows it, or what is missing"),
});

const JUDGE_SYSTEM = `You check the end state of an end-to-end test on a web app. You get the steps that were done, what the wallet sent, the expected result, a screenshot and the page text.
Say ok=true only when the page plainly shows the expected result. Name the exact text that shows it, or say what is missing. Don't guess.
A value within 1% of the expected one is the same value: apps round and truncate (0.0099 for 0.01).
The page only shows the end. When the expected result talks about a change or an earlier moment, check that the end state fits the steps and what the wallet sent; don't fail it just because the earlier state isn't on screen. A step may come with what was seen while doing it ("seen:"): an earlier moment can be shown there, when the end state fits it. Anything on the page that contradicts it is a fail.
Whether a transaction was mined is settled by what the wallet sent, not by the page: a transfer to another chain goes on reading "in progress" or "awaiting" here, because only the test chain sees it.`;

/** A live account keeps what earlier runs left, so an old entry that happens to match proves nothing. */
const JUDGE_LIVE = `
The account is on a live chain and keeps what earlier runs left: orders, positions, balances, history. Only what this run did shows the result: the newest entry (marked "just now" or at the top), with the exact amount or price the steps entered. An older entry with the same value, or a total that merely includes it, doesn't; say so and fail it.
When the expected result is a change ("falls by about $20", "one more order"), judge it against what the page showed before the test, given with the test. A figure that follows the market may have moved a little on its own.`;

export interface JudgeOptions {
  /** A chain the test ran on is live: the account carries earlier runs' leftovers. */
  live?: boolean;
  /** What the start page showed before the first step, from readBaseline. */
  before?: string;
  /** What was seen while doing each step (a step the model did has a note; a replayed one none). */
  seen?: (string | undefined)[];
}

const Baseline = z.object({
  before: z.string().describe('One line under 300 characters: each figure the expected result names with its value exactly as the page writes it now, e.g. "Cash $29,845.12; Open orders 2; AAPL position none". A figure not on this page: say so.'),
});

const BASELINE_SYSTEM = `Before an end-to-end test runs on a web app, you note the figures its expected result is about as the page shows them now, so a change can be judged afterwards. You get the test's expected result and the page text.
Write each figure the expected result names (a balance, a size, a count of orders, a position) with its current value exactly as the page writes it. A figure that isn't on this page: say "not on this page". Nothing else, and no guesses.`;

/** The figures a test's expected result is about, as the start page shows them before the first step. For live chains, where the account differs on every run. */
export async function readBaseline(session: DrillSession, llm: Llm, test: TestSpec): Promise<string | undefined> {
  await settle(session);
  const text = formatSnapshot(await takeSnapshot(session.page, { maxChars: 12_000 }));
  const r = await llm.structured({ system: BASELINE_SYSTEM, prompt: [`Test: ${test.name}`, `Expected: ${test.expected}`, "", "The page now:", text].join("\n"), schema: Baseline, name: "baseline" });
  const before = r.before.trim().slice(0, 300);
  return before || undefined;
}

/** Did the test end where it should? Asked on every run: a saved text can't tell a result from a label that always shows. */
export async function judgeExpected(session: DrillSession, llm: Llm, test: TestSpec, opts: JudgeOptions = {}): Promise<{ ok: boolean; reason: string }> {
  await settle(session);
  const first = await askJudge(session, llm, test, opts);
  // A success dialog often covers the result; look again without it.
  return first.ok || !(await closeDialog(session)) ? first : askJudge(session, llm, test, opts);
}

async function closeDialog(session: DrillSession): Promise<boolean> {
  if (!(await openDialog(session.page))) return false;
  await session.page.keyboard.press("Escape");
  await settle(session);
  return !(await openDialog(session.page));
}

/** What the chain made of a transaction the wallet sent; nothing for a signature or a request that wasn't approved. */
async function minedOrNot(session: DrillSession, r: WalletRequest): Promise<string | undefined> {
  if (r.outcome !== "approved" || typeof r.result !== "string" || !/^0x[0-9a-f]{64}$/i.test(r.result)) return undefined;
  const receipt = await session.chains.client(r.chainId).getTransactionReceipt({ hash: r.result as Hex }).catch(() => undefined);
  return receipt ? (receipt.status === "success" ? "mined" : "reverted on the chain") : "not mined yet";
}

async function askJudge(session: DrillSession, llm: Llm, test: TestSpec, opts: JudgeOptions): Promise<{ ok: boolean; reason: string }> {
  const page = session.page;
  // The whole page: what proves the result is often below the fold.
  const png = await page.screenshot({ type: "png", fullPage: true });
  const text = formatSnapshot(await takeSnapshot(page, { maxChars: 12_000 }));
  const signed = session.wallet.requests().filter((r) => r.kind === "sign");
  const sent = signed.length ? await Promise.all(signed.map(async (r) => `- ${decodeWalletRequest(r).summary} (${[r.outcome, await minedOrNot(session, r)].filter(Boolean).join(", ")})`)) : ["- nothing"];
  return llm.structured({
    system: opts.live ? JUDGE_SYSTEM + JUDGE_LIVE : JUDGE_SYSTEM,
    prompt: [
      `Test: ${test.name}`,
      "Steps done:",
      ...test.steps.map((s, i) => `${i + 1}. ${s.text}${opts.seen?.[i] ? ` — seen: ${opts.seen[i]!.slice(0, 300)}` : ""}`),
      "What the wallet sent:",
      ...sent,
      `Expected: ${test.expected}`,
      ...(opts.before ? [`Before the test the page showed: ${opts.before}`] : []),
      "",
      "The page now:",
      text,
    ].join("\n"),
    images: [{ data: png.toString("base64"), mediaType: "image/png" }],
    schema: Verdict,
    name: "verdict",
  });
}
