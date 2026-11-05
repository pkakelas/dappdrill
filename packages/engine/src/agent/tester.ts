/**
 * Runs one plain-English test step. Cached actions from the last passing run
 * replay first; when they break, or there are none, the fast model does the
 * step with the browser tools and its actions become the new cache. A step
 * the fast model can't settle goes to the acting model once.
 */
import { z } from "zod";
import { describeStep, type AppMap, type Blocked, type Step, type TestSpec, type WalletRequest } from "@dappdrill/core";
import type { AgentTool, DrillSession, Inbox, Llm } from "../types.js";
import { formatSnapshot, takeSnapshot } from "./snapshot.js";
import { browserTools, Recorder, settle } from "./tools.js";

const FAST_TURNS = 14;
const STRONG_TURNS = 20;

export const STEP_SYSTEM = `You carry out one step of an end-to-end test on a web app (often a web3 dApp with an injected test wallet).
You get the test's goal, all its steps, and the one step to do now. Do only that step, with as few actions as you can.

- Use the page as a user would: look, click, type, select. Prefer what is visible over guessing URLs.
- When the step is already true (the wallet is already connected, the page is already open), do nothing and call step_done.
- Wallet requests show up in tool results. Approve them with wallet_approve unless the step says to reject.
- When the step asks to check something, confirm it on the page and call expect_text with a short exact text that proves it.
- Never solve a CAPTCHA or bot check. Call report_blocked.
- A click that fails tells you nothing about the app. Look again with a screenshot and try another element with the same name.
- Only report what you saw. A wallet request that returned an empty list means nothing is connected.
- Finish with step_done. ok=false with cause "app" when a user would see the app in the way (an error, a disabled button, missing content); cause "unsure" when you couldn't work out how to do the step.`;

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
  if (!blocked && deps.strong && (!done || (!done.ok && done.cause === "unsure"))) {
    const hint = done ? `A quicker attempt gave up: ${done.reason}` : "A quicker attempt ran out of actions before finishing.";
    done = (await attempt(deps.strong, STRONG_TURNS, deps, test, index, recorder, hooks, broke, hint)).done;
  }
  const actions = recorder.take();
  const did = actions.map(describeStep);
  if (blocked) return { ok: false, via: "agent", did, note: `Blocked: ${blocked.reason}`, blocked };
  if (stuckOn && !done?.ok && done?.cause !== "app") return { ok: false, via: "agent", did, note: `Couldn't click “${stuckOn}”, so this step didn't finish.`, stuck: true };
  if (!done) return { ok: false, via: "agent", did, note: "Couldn't finish this step." };
  return { ok: done.ok, via: "agent", did, note: done.reason || undefined, actions: done.ok ? actions : undefined };
}

interface Done {
  ok: boolean;
  cause?: "app" | "unsure";
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
    {
      name: "expect_text",
      description: "Check that a short exact text is visible on the page now. Records it as a check that later runs repeat.",
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
        cause: z.enum(["app", "unsure"]).optional().describe("When ok=false: app = the app is broken or in the way; unsure = you couldn't work it out"),
        reason: z.string().describe("One short sentence: what happened, or what's wrong"),
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

const Verdict = z.object({
  ok: z.boolean().describe("true when the page shows the expected result"),
  reason: z.string().describe("One short sentence naming what shows it, or what is missing"),
  proof: z.string().optional().describe("When ok: a short exact text on the page (under 60 characters) that proves it, e.g. 'Order filled'"),
});

const JUDGE_SYSTEM = `You check the end state of an end-to-end test on a web app. You get the expected result, a screenshot and the page text.
Say ok=true only when the page plainly shows the expected result. Name the exact text that shows it, or say what is missing. Don't guess.`;

/** Did the test end where it should? Last run's proof text answers without a model when it still shows. */
export async function judgeExpected(session: DrillSession, llm: Llm, test: TestSpec): Promise<{ ok: boolean; reason: string; proof?: string }> {
  await settle(session);
  const page = session.page;
  const shows = (text: string) => page.getByText(text).first().isVisible().catch(() => false);
  if (test.proof && (await shows(test.proof))) return { ok: true, reason: `Shows “${test.proof}”.`, proof: test.proof };

  const png = await page.screenshot({ type: "png" });
  const text = formatSnapshot(await takeSnapshot(page, { maxChars: 6_000 }));
  const v = await llm.structured({
    system: JUDGE_SYSTEM,
    prompt: `Test: ${test.name}\nExpected: ${test.expected}\n\nThe page now:\n${text}`,
    images: [{ data: png.toString("base64"), mediaType: "image/png" }],
    schema: Verdict,
    name: "verdict",
  });
  // Only text that is really on the page becomes the shortcut for next time.
  const proof = v.ok && v.proof && (await shows(v.proof)) ? v.proof : undefined;
  return { ok: v.ok, reason: v.reason, proof };
}
