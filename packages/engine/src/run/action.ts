/**
 * Doing one action. Code replays its recorded browser actions with no model. A model does the
 * action from its sentence when there is nothing recorded, or when the recording stopped working:
 * the quick model first, and the fast model when the quick one didn't get it done. What a model
 * did for a code action comes back as the recording to replay from then on.
 */
import { z } from "zod";
import { describeStep, forkBlindLine, type Action, type Blocked, type BrowserAction, type WalletRequest } from "@dappdrill/core";
import { formatSnapshot, takeSnapshot } from "../agent/snapshot.js";
import { browserTools, inboxTool, Recorder, settle, walletLine } from "../agent/tools.js";
import { debug } from "../pipeline/session.js";
import { replayScript } from "../replay/replay.js";
import type { AgentTool, Llm } from "../types.js";
import { unpaid } from "../wallet/errors.js";
import { lines, reviewRequest, type Running, type Went } from "./running.js";

const QUICK_TURNS = 12;
const FAST_TURNS = 20;

/** Does the action and lets the page come to rest, so every check after it reads a still page. */
export async function doAction(run: Running, index: number): Promise<Went> {
  const went = await act(run, index);
  await settle(run.session);
  return went;
}

async function act(run: Running, index: number): Promise<Went> {
  const action = run.steps[index] as Action;
  if (action.by === "llm") return (await byModel(run, index)).went;
  const replayed = action.run.length ? await replay(run, action.run) : undefined;
  if (replayed?.ok) return { status: "pass", by: "code", did: action.run.map(describeStep) };
  const { went, steps } = await byModel(run, index, replayed?.error);
  return { ...went, redone: replayed?.error, recorded: went.status === "pass" && steps.length ? steps : undefined };
}

async function replay(run: Running, actions: BrowserAction[]): Promise<{ ok: boolean; error?: string }> {
  const { env, session } = run;
  const script = { id: run.name, name: run.name, origin: "described" as const, startUrl: session.page.url(), params: [], steps: actions };
  // A recorded approval is held to the same rule as a model's: refused, it is rejected and the recording didn't work.
  let refused: string | undefined;
  const respond = async ({ step, pending }: { step: BrowserAction; pending: { request: WalletRequest } }) => {
    if (step.kind !== "wallet" || step.respond !== "approve") return "default" as const;
    refused ??= run.refuseApprove?.(pending.request);
    return refused ? ("reject" as const) : ("default" as const);
  };
  const r = await replayScript(session, script, { here: true, reviewer: env.reviewer, inbox: env.inbox, signal: run.signal, log: debug, hooks: { respond } });
  run.reviews.push(...r.signingReviews);
  return refused ? { ok: false, error: refused } : { ok: r.completed, error: r.error };
}

const SYSTEM = `You do one action of an end-to-end test on a web app (often a web3 dApp with an injected test wallet).
You get what the test is after, its lines, and the one action to do now. Do only that action, with as few steps as you can. Lines marked (check) are decided by someone else afterwards: don't make them, and don't act to make them come true.

- Use the page as a user would: look, click, type, select. Prefer what is visible over guessing URLs.
- The action names its values. Use exactly those: the amount it says, the option it says.
- When what the action asks for is already so (the wallet is already connected, the page is already open), do nothing and call done. That is for state you can see, not for doing: an action that says to click, enter or sign something is done when you did it.
- The browser may put a first-visit prompt in the way that the lines don't mention: terms to accept, a cookie banner, a welcome tour. Accept or close it as part of your action.
- Wallet requests show up in tool results. Approve them with wallet_approve unless the action says to reject.
- Never solve a CAPTCHA or bot check. Call report_blocked. Do the same when the app refuses this user or wallet ("access unavailable", a region block); don't try to get around it.
- A click that fails tells you nothing about the app. Look again with a screenshot and try another element with the same name.
- Only report what you saw.
- Finish with done. ok=false with cause "app" when a user would find the app in the way (an error, a button that stays disabled, missing content); cause "unsure" when you couldn't work out how to do it.
- You are told what the wallet holds on the test chain. When that is what stops you because the page shows something else (0 ETH while it holds 100), use cause "fork": the app is reading from somewhere other than the test chain.`;

interface Done {
  ok: boolean;
  cause?: "app" | "unsure" | "fork";
  reason: string;
}

/** A model does the action. `steps` is what it did in the browser, as a recording. */
async function byModel(run: Running, index: number, broke?: string): Promise<{ went: Went; steps: BrowserAction[] }> {
  const recorder = new Recorder(run.session);
  recorder.start(run.name);
  const went = await ladder(run, index, recorder, broke);
  const steps = recorder.take();
  return { went: { ...went, did: steps.map(describeStep) }, steps };
}

/** The quick model, then the fast one, and what to make of where they got. */
async function ladder(run: Running, index: number, recorder: Recorder, broke?: string): Promise<Went> {
  const { env, session } = run;
  const { wallet, chains } = session;
  const asked = wallet.requests().length;
  const startedAt = Date.now();
  const state: Attempting = { recorder, broke };

  let llm = env.quickLlm();
  let done = await attempt(run, index, llm, QUICK_TURNS, state);
  // What our wallet couldn't pay for says nothing about the app, and another try can't change it.
  const noFunds = () => wallet.requests().slice(asked).map((r) => unpaid(r, wallet.address(), chains.has(r.chainId) && chains.mode(r.chainId) === "live")).find(Boolean);
  // The quick model's word isn't enough to call an action undoable: the fast model gets it too.
  if (!done?.ok && !state.blocked && !noFunds()) {
    llm = env.fastLlm();
    state.hint = done ? `A quicker attempt gave up: ${done.reason}` : "A quicker attempt ran out of turns before finishing.";
    done = await attempt(run, index, llm, FAST_TURNS, state);
  }

  const went = { by: "llm" as const, model: llm.model };
  if (state.blocked) return { ...went, status: "unsure", note: `Blocked: ${state.blocked.reason}` };
  if (done?.ok) return { ...went, status: "pass", note: done.reason };
  const unfunded = noFunds();
  if (unfunded) return { ...went, status: "unsure", note: unfunded };
  if (!done) return { ...went, status: "unsure", note: "Ran out of turns before the action was done." };
  // The model's word alone doesn't excuse a wrong balance: a server must really have been asked about the wallet.
  const told = done.cause === "fork" ? session.traffic.hostsTold(wallet.address()) : [];
  if (told.length) return { ...went, status: "unsure", note: forkBlindLine(done.reason, told) };
  if (state.stuckOn && done.cause !== "app") return { ...went, status: "unsure", note: `Couldn't click “${state.stuckOn}”, so the action wasn't done.` };
  if (done.cause === "unsure") return { ...went, status: "unsure", note: done.reason };
  // A server that refused something meanwhile, in its own words, names who said no.
  const refused = session.traffic.refusedSince(startedAt);
  return { ...went, status: "fail", note: `${done.reason}${refused.length ? ` (${refused.join("; ")})` : ""}` };
}

/** What carries over from one model's attempt to the next. */
interface Attempting {
  recorder: Recorder;
  /** Why the recorded actions stopped working, for a code action. */
  broke?: string;
  hint?: string;
  blocked?: Blocked;
  /** What the latest click failed to reach, until a later click lands. */
  stuckOn?: string;
}

async function attempt(run: Running, index: number, llm: Llm, maxTurns: number, state: Attempting): Promise<Done | undefined> {
  const { env, session } = run;
  let done: Done | undefined;
  const tools: AgentTool[] = [
    ...browserTools({
      session,
      recorder: state.recorder,
      inbox: env.inbox,
      onBlocked: (b) => (state.blocked = b),
      onClick: (failed) => (state.stuckOn = failed),
      beforeApprove: (request) => reviewRequest(run, request),
      refuseApprove: run.refuseApprove,
    }),
    ...(env.inbox ? [inboxTool(env.inbox)] : []),
    {
      name: "done",
      description: "Finish the action. Call it exactly once.",
      schema: z.object({
        ok: z.boolean(),
        cause: z.enum(["app", "unsure", "fork"]).optional().describe("When ok=false: app = the app is broken or in the way; unsure = you couldn't work it out; fork = the page disagrees with what the wallet holds on the test chain"),
        reason: z.string().describe("One short sentence: what you did, or what's wrong. When the app shows an error, give its own words and where they came from if you can tell (the app, its sign-in provider, the wallet)"),
      }),
      handler: async (input) => {
        done = input;
        return "Recorded. Stop now.";
      },
    },
  ];

  await settle(session);
  const prompt = [
    `Test: ${run.name}`,
    `What it is after: ${run.goal}`,
    await walletLine(session),
    run.notes.length ? `What is known about this app:\n${run.notes.map((n) => `- ${n}`).join("\n")}` : "",
    "Lines:",
    ...lines(run, index),
    state.broke ? `\nThis action used to be replayed from a recording, which failed just now: ${state.broke}` : "",
    state.hint ? `\n${state.hint}` : "",
    "",
    "The page now:",
    formatSnapshot(await takeSnapshot(session.page, { maxChars: 9_000 })),
  ].filter(Boolean).join("\n");

  const res = await llm.runAgent({ system: SYSTEM, prompt, tools, maxTurns, signal: run.signal });
  return done ?? (res.stopReason === "end_turn" && res.text ? { ok: false, cause: "unsure", reason: res.text.slice(0, 200) } : undefined);
}
