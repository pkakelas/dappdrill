/**
 * The browser and wallet tools a model acts with while a test is made or repaired. Every action goes
 * through the Recorder, which turns it into a core Step with a Locator that names the element the way a
 * user would, so whatever the model did can be replayed by code with no model.
 */
import { formatEther } from "viem";
import { z } from "zod";
import { chainName, nowIso, type Blocked, type Locator, type Step, type WalletRequest, describeBlock } from "@dappdrill/core";
import { detectBotCheck } from "../browser/access.js";
import { fillField } from "../replay/fill.js";
import { waitQuiet } from "../replay/quiet.js";
import type { AgentTool, AgentToolResult, DrillSession, Inbox } from "../types.js";
import { elementByRef, formatSnapshot, locatorFor, takeSnapshot } from "./snapshot.js";
import { decodeWalletRequest, matchTypedAmount } from "./wallet-decode.js";

const SETTLE_MS = 600;
/** How long a busy button gets to finish before the model looks at the page. */
const QUIET_MS = 10_000;
const ACTION_SNAPSHOT_CHARS = 9_000;

/** Records what a model does, once started. Until then, and after `take()`, nothing is kept. */
export class Recorder {
  private active?: Step[];
  private typed: string[] = [];

  constructor(private readonly session: DrillSession) {}

  start() {
    this.active = [];
    this.typed = [];
  }

  add(step: Step) {
    this.active?.push(step);
    if (step.kind === "fill") this.typed.push(step.value);
  }

  typedValues(): string[] {
    return this.typed;
  }

  /**
   * The clicks since the last non-click step led to a wallet connect. Apps
   * often reconnect by themselves on the next load, so those clicks must not
   * fail a replay when the button is gone.
   */
  markConnectClicks() {
    const steps = this.active ?? [];
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]!;
      if (s.kind !== "click") break;
      s.optional = true;
    }
  }

  /** Close the recording and return its steps, with the wallet's address made generic. */
  take(): Step[] {
    const steps = this.active ?? [];
    this.active = undefined;
    this.generic(steps);
    return steps;
  }

  /** The wallet's address becomes {{account}}, so steps replay with any test account. */
  private generic(steps: Step[]) {
    const addr = this.session.wallet.address();
    const full = new RegExp(addr, "gi");
    const short = new RegExp(`${addr.slice(0, 6)}(…|\\.\\.\\.)${addr.slice(-4)}`, "gi");
    const generic = (s: string) => s.replace(full, "{{account}}").replace(short, "{{account-head}}$1{{account-tail}}");
    for (const s of steps) {
      if (s.kind === "fill") s.value = generic(s.value);
      if (s.kind === "goto") s.url = generic(s.url);
      if (s.kind === "wait" && s.text) s.text = generic(s.text);
      if (s.kind !== "expect") continue;
      if (s.assert.type === "url") s.assert.contains = generic(s.assert.contains);
      else s.assert.text = generic(s.assert.text);
    }
  }
}

export interface ToolContext {
  session: DrillSession;
  recorder: Recorder;
  inbox?: Inbox;
  /** Called when the agent reports a bot check; the tool loop should stop afterwards. */
  onBlocked?: (blocked: Blocked) => void;
  /** Returns a message when the time/test budget is spent, shown with every tool result. */
  budgetNote?: () => string | undefined;
  /** Runs before the wallet approves a signing request (the signing review). */
  beforeApprove?: (request: WalletRequest) => Promise<void>;
  /** Why this request must not be approved, when it mustn't. */
  refuseApprove?: (request: WalletRequest) => string | undefined;
  /** After each click: undefined when it landed, otherwise what we failed to click. */
  onClick?: (failed?: string) => void;
  /** Texts that name this run's own rows ("287.40"): one of several alike buttons is recorded by the row it is in. */
  rowTexts?: string[];
}

/** Tools for looking at and acting on the page; recording happens as a side effect. */
export function browserTools(ctx: ToolContext): AgentTool[] {
  const { session, recorder } = ctx;
  const page = () => session.page;
  const origin = new URL(session.target.url).origin;
  // An app that redirects to another domain (app.spark.fi → app.spark.finance) lives on the one it landed on.
  const landed = page().url().startsWith("http") ? new URL(page().url()).origin : origin;
  const seenRequests = new Set<string>(session.wallet.requests().map((r) => r.id));
  /** Says what was just done, for whoever watches the work: one short sentence naming the control. */
  const did = (text: string) => void session.emit({ type: "did", text, dir: session.artifactsDir, at: nowIso() });

  /**
   * Wait for the page to settle, then describe the new state plus any new wallet request. By now the
   * action is done: a page that can't be read yet (it is navigating) is said so, and doesn't turn the
   * action into a failed one that the model would do again.
   */
  const after = async (what: string): Promise<AgentToolResult> => {
    const lines = [what];
    try {
      await settle(session);
      const blocked = await detectBotCheck(session.page);
      if (blocked) lines.push(`WARNING: ${describeBlock(blocked)} (${blocked.reason}). Do not try to solve it; call report_blocked.`);
      const fresh = session.wallet.requests().filter((r) => !seenRequests.has(r.id));
      for (const r of fresh) {
        seenRequests.add(r.id);
        lines.push(describeRequest(r));
      }
      if (fresh.some((r) => r.kind === "connect")) recorder.markConnectClicks();
      const pending = pendingSign(session);
      if (pending) lines.push(`Wallet request ${pending.id} is waiting: ${decodeWalletRequest(pending).summary}. Call wallet_approve or wallet_reject.`);
      const note = ctx.budgetNote?.();
      if (note) lines.push(`NOTE: ${note}`);
      const snap = await takeSnapshot(page(), { maxChars: ACTION_SNAPSHOT_CHARS });
      lines.push("", formatSnapshot(snap));
    } catch (e) {
      const cause = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      lines.push("", `That is done, but the page is still changing and couldn't be read just now (${cause}). Don't do it again: look first.`);
    }
    return { text: lines.join("\n") };
  };

  const target = async (ref: string) => {
    const locator = await locatorFor(page(), ref, ctx.rowTexts);
    return { locator, el: elementByRef(page(), ref) };
  };

  const tools: AgentTool[] = [
    {
      name: "look",
      description: "Describe the current page: URL, open dialogs, interactive elements with refs, visible text. Set screenshot=true to also get an image (costs more; use when layout matters).",
      schema: z.object({ screenshot: z.boolean().optional() }),
      handler: async ({ screenshot }) => {
        const snap = await takeSnapshot(page());
        const text = formatSnapshot(snap);
        if (!screenshot) return text;
        const png = await page().screenshot({ type: "png" });
        return { text, image: { data: png.toString("base64"), mediaType: "image/png" } };
      },
    },
    {
      name: "click",
      description: "Click an element by its ref (e.g. e12).",
      schema: z.object({
        ref: z.string(),
        why: z.string().optional().describe("Short note, e.g. 'Open wallet picker'"),
        optional: z
          .boolean()
          .optional()
          .describe("True for a click that is made only when the page asks for it: a one-time prompt (terms, cookie banner, onboarding, one-time trading setup), a confirmation that doesn't always come, a row that may not be listed. Replays go on without it, and without the signature it asks for, when it isn't there."),
      }),
      handler: async ({ ref, why, optional }) => {
        const { locator, el } = await target(ref);
        const label = (await el.textContent().catch(() => null))?.trim().slice(0, 60);
        try {
          await el.click({ timeout: 5_000 });
        } catch (e) {
          ctx.onClick?.(label || ref);
          const cause = (e instanceof Error ? e.message : String(e)).split("\n")[0];
          return `The click never reached ${ref} (${cause}). This says nothing about the app: the element may be a hidden copy, or covered for a moment. Look again with screenshot=true, and if another element has the same name, try that one.`;
        }
        ctx.onClick?.();
        recorder.add({ kind: "click", target: locator, note: why ?? (label ? `Click "${label}"` : undefined), ...(optional ? { optional } : {}) });
        did(`Clicked “${label || named(locator)}”`);
        return after(`Clicked ${ref}.`);
      },
    },
    {
      name: "type",
      description: "Clear a field and type into it. Set enter=true to press Enter afterwards.",
      schema: z.object({ ref: z.string(), text: z.string(), enter: z.boolean().optional() }),
      handler: async ({ ref, text, enter }) => {
        const { locator, el } = await target(ref);
        const filled = await fillField(page(), el, text, 5_000);
        recorder.add({ kind: "fill", target: locator, value: text });
        if (enter) {
          await el.press("Enter");
          recorder.add({ kind: "press", key: "Enter", target: locator });
        }
        did(`Typed “${short(text)}” into “${named(locator)}”`);
        if (!filled.took) return after(`Typed "${text}" into ${ref}, but the field shows "${filled.shows}". The page may format or refuse what was typed; look before going on.`);
        return after(`Typed "${text}" into ${ref}.`);
      },
    },
    {
      name: "select",
      description: "Pick an option in a <select> by its visible label or value.",
      schema: z.object({ ref: z.string(), value: z.string() }),
      handler: async ({ ref, value }) => {
        const { locator, el } = await target(ref);
        await el.selectOption({ label: value }, { timeout: 5_000 }).catch(() => el.selectOption(value, { timeout: 5_000 }));
        recorder.add({ kind: "select", target: locator, value });
        did(`Chose “${short(value)}” in “${named(locator)}”`);
        return after(`Selected "${value}" in ${ref}.`);
      },
    },
    {
      name: "press",
      description: "Press a keyboard key (Enter, Escape, Tab, ArrowDown…), optionally on an element.",
      schema: z.object({ key: z.string(), ref: z.string().optional() }),
      handler: async ({ key, ref }) => {
        if (ref) {
          const { locator, el } = await target(ref);
          await el.press(key, { timeout: 5_000 });
          recorder.add({ kind: "press", key, target: locator });
        } else {
          await page().keyboard.press(key);
          recorder.add({ kind: "press", key });
        }
        did(`Pressed ${key}`);
        return after(`Pressed ${key}.`);
      },
    },
    {
      name: "goto",
      description: "Navigate to a URL or path on the app's own origin. Other origins are refused.",
      schema: z.object({ url: z.string() }),
      handler: async ({ url }) => {
        const abs = new URL(url, page().url());
        if (abs.origin !== origin && abs.origin !== landed) return `Refused: ${abs.origin} is outside the app (${origin}). Stay on the app's pages.`;
        await page().goto(abs.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
        recorder.add({ kind: "goto", url: abs.pathname + abs.search });
        did(`Opened ${short(abs.pathname + abs.search)}`);
        return after(`Opened ${abs.href}.`);
      },
    },
    {
      name: "scroll",
      description: "Scroll the page by one screen.",
      schema: z.object({ direction: z.enum(["down", "up"]) }),
      handler: async ({ direction }) => {
        await page().mouse.wheel(0, direction === "down" ? 600 : -600);
        return after(`Scrolled ${direction}.`);
      },
    },
    {
      name: "back",
      description: "Go back in browser history.",
      schema: z.object({}),
      handler: async () => {
        await page().goBack({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => null);
        did("Went back a page");
        return after("Went back.");
      },
    },
    {
      name: "wallet_status",
      description: "Show the wallet: address, chain, and every request the dApp has made so far.",
      schema: z.object({}),
      handler: async () => {
        const w = session.wallet;
        const reqs = w.requests();
        const lines = [`Address ${w.address()} (account A), chain ${w.chainId()}, policy ${JSON.stringify(w.policy())}`];
        lines.push(reqs.length ? "Requests:" : "No wallet requests yet.");
        for (const r of reqs.slice(-15)) lines.push(describeRequest(r));
        return lines.join("\n");
      },
    },
    {
      name: "wallet_approve",
      description: "Approve the pending signing request (transaction or signature) in the wallet. Records a wallet step with what the request must look like on replay.",
      schema: z.object({
        optional: z.boolean().optional().describe("True when the app doesn't ask for this every time (\"approve the wallet request if one comes\"). Replays go on without it when nothing is asked; a request that does come must still look like this one."),
      }),
      handler: async ({ optional }) => {
        const pending = pendingSign(session);
        if (!pending) return "No signing request is pending. Trigger one in the app first.";
        const refused = ctx.refuseApprove?.(pending);
        if (refused) return refused;
        const decoded = decodeWalletRequest(pending);
        const match = matchTypedAmount(recorder.typedValues(), decoded.amounts);
        const expect = { ...decoded.expectation };
        if (match) expect.amountMustEqual = match.typed;
        await ctx.beforeApprove?.(pending);
        await session.wallet.approve(pending.id);
        recorder.add({ kind: "wallet", respond: "approve", expect, note: `Approve ${decoded.summary.split(":")[0]}`, ...(optional ? { optional } : {}) });
        did(`Signed in the wallet: ${decoded.asks}`);
        return after(`Approved ${pending.id} (${decoded.summary}).${match ? ` The amount matches what you typed ("${match.typed}").` : ""}`);
      },
    },
    {
      name: "wallet_reject",
      description: "Reject the pending signing request as the user would (error 4001).",
      schema: z.object({}),
      handler: async () => {
        const pending = pendingSign(session);
        if (!pending) return "No signing request is pending.";
        const decoded = decodeWalletRequest(pending);
        recorder.add({ kind: "wallet", respond: "reject", expect: decoded.expectation, note: `Reject ${decoded.summary.split(":")[0]}` });
        await session.wallet.reject(pending.id);
        did(`Rejected in the wallet: ${decoded.asks}`);
        return after(`Rejected ${pending.id} (${decoded.summary}).`);
      },
    },
    {
      name: "inbox_code",
      description: "Wait for the login code emailed to the test inbox and type it into the given field. Only for email-code logins.",
      schema: z.object({ ref: z.string(), sinceSeconds: z.number().optional().describe("Only accept mail newer than this many seconds (default 120)") }),
      handler: async ({ ref, sinceSeconds }) => {
        if (!ctx.inbox) return "No test inbox is configured for this run.";
        const code = await ctx.inbox.latestCode({ sinceMs: Date.now() - (sinceSeconds ?? 120) * 1000, timeoutMs: 90_000 });
        const { locator, el } = await target(ref);
        await el.fill(code, { timeout: 5_000 });
        recorder.add({ kind: "email-code", target: locator });
        did(`Typed the emailed code into “${named(locator)}”`);
        return after(`Typed the emailed code into ${ref}.`);
      },
    },
    {
      name: "report_blocked",
      description: "Report that a CAPTCHA, bot check or similar blocks progress. Never try to solve or bypass these.",
      schema: z.object({ reason: z.string() }),
      handler: async ({ reason }) => {
        const seen = await detectBotCheck(session.page);
        ctx.onBlocked?.({ provider: seen?.provider, reason, url: session.page.url() });
        return `Recorded: blocked (${reason}). Stop exploring this path.`;
      },
    },
  ];
  return tools;
}

/** An element as a user would name it, for saying what was done to it. */
const named = (l: Locator): string => short(l.name ?? l.label ?? l.text ?? l.placeholder ?? l.near ?? "a control");
const short = (text: string): string => (text.length > 60 ? `${text.slice(0, 59)}…` : text);

/** The session's inbox address, so the agent can type it into a login form. */
export function inboxTool(inbox: Inbox): AgentTool {
  return {
    name: "inbox_address",
    description: "The disposable email address of the test inbox, for email-code logins.",
    schema: z.object({}),
    handler: async () => inbox.address,
  };
}

export function pendingSign(session: DrillSession): WalletRequest | undefined {
  return session.wallet.requests().find((r) => r.kind === "sign" && r.outcome === "pending");
}

export function describeRequest(r: WalletRequest): string {
  if (r.kind === "other" && r.outcome === "approved") return `- ${r.id} ${r.method} → returned ${JSON.stringify(r.result ?? null).slice(0, 120)}`;
  if (r.kind !== "sign") return `- ${r.id} ${r.method} → ${r.outcome}`;
  return `- ${r.id} ${decodeWalletRequest(r).summary} → ${r.outcome}${r.error ? ` (${r.error})` : ""}`;
}

/** Give the app a moment to react, let a busy button ("Placing…") finish, then wait for network quiet (bounded). */
export async function settle(session: DrillSession): Promise<void> {
  await session.page.waitForTimeout(SETTLE_MS);
  await waitQuiet(session.page, QUIET_MS, () => pendingSign(session) !== undefined);
  await session.page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => null);
}

/** What the test wallet holds on the chain it is on, for a model that would otherwise take a page showing 0 at its word. */
export async function walletLine(session: DrillSession): Promise<string> {
  try {
    const address = session.wallet.address();
    const chainId = session.wallet.chainId();
    const wei = await session.chains.client(chainId).getBalance({ address });
    return `The test wallet ${address} holds ${formatEther(wei)} of the native coin on ${chainName(chainId)}.`;
  } catch {
    return "";
  }
}
