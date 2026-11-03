/**
 * The browser/wallet tools the model drives, shared by explore, describe and
 * repair. Every action goes through the Recorder, which turns it into a core
 * Step with a robust Locator, so whatever the agent did can be replayed
 * without a model.
 */
import { z } from "zod";
import { applyParams, type Flow, type Step, type WalletRequest } from "@dappdrill/core";
import type { AgentTool, AgentToolResult, DrillSession, Inbox } from "../types.js";
import { elementByRef, formatSnapshot, locatorFor, takeSnapshot } from "./snapshot.js";
import { decodeWalletRequest, matchTypedAmount, short } from "./wallet-decode.js";

const SETTLE_MS = 600;
const ACTION_SNAPSHOT_CHARS = 9_000;
const BLOCKED_PATTERNS = /captcha|turnstile|just a moment|verify you are human|checking your browser|attention required|access denied/i;

export interface RecordedFlow {
  name: string;
  startUrl: string;
  steps: Step[];
  params: Flow["params"];
  chainId: number;
}

/** Records the steps of the flow currently being captured. */
export class Recorder {
  private active?: { name: string; startUrl: string; steps: Step[] };
  private typed: string[] = [];

  constructor(private readonly session: DrillSession) {}

  recording(): boolean {
    return !!this.active;
  }

  /** Begin a flow at the current URL. `prefix` steps (already replayed) count as part of it. */
  start(name: string, prefix: Step[] = [], params: Record<string, string> = {}) {
    this.active = { name, startUrl: this.session.page.url(), steps: [...prefix] };
    this.typed = prefix.flatMap((s) => (s.kind === "fill" ? [applyParams(s.value, params)] : []));
  }

  add(step: Step) {
    this.active?.steps.push(step);
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
    const steps = this.active?.steps ?? [];
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]!;
      if (s.kind !== "click") break;
      s.optional = true;
    }
  }

  steps(): Step[] {
    return this.active?.steps ?? [];
  }

  /** Close the flow: amounts the user typed that showed up in a transaction become {{amount}}. */
  end(): RecordedFlow | undefined {
    const a = this.active;
    if (!a) return undefined;
    this.active = undefined;
    const params: Flow["params"] = [];
    const amountStep = a.steps.find((s) => s.kind === "wallet" && s.expect?.amountMustEqual && !s.expect.amountMustEqual.includes("{{"));
    if (amountStep?.kind === "wallet" && amountStep.expect?.amountMustEqual) {
      const typed = amountStep.expect.amountMustEqual;
      params.push({ name: "amount", default: typed, description: "Amount typed into the form" });
      for (const s of a.steps) {
        if (s.kind === "fill" && s.value === typed) s.value = "{{amount}}";
        if (s.kind === "wallet" && s.expect?.amountMustEqual === typed) s.expect.amountMustEqual = "{{amount}}";
      }
    }
    return { name: a.name, startUrl: a.startUrl, steps: a.steps, params, chainId: this.session.wallet.chainId() };
  }

  discard() {
    this.active = undefined;
  }
}

export interface ToolContext {
  session: DrillSession;
  recorder: Recorder;
  inbox?: Inbox;
  /** Called when the agent reports a bot check; the tool loop should stop afterwards. */
  onBlocked?: (reason: string) => void;
  /** Returns a message when the time/flow budget is spent, shown with every tool result. */
  budgetNote?: () => string | undefined;
}

/** Tools for looking at and acting on the page; recording happens as a side effect. */
export function browserTools(ctx: ToolContext): AgentTool[] {
  return createToolkit(ctx).tools;
}

/** The browser tools plus `after()`, which callers use to describe the state after their own actions. */
export function createToolkit(ctx: ToolContext): { tools: AgentTool[]; after: (what: string) => Promise<AgentToolResult> } {
  const { session, recorder } = ctx;
  const page = () => session.page;
  const origin = new URL(session.target.url).origin;
  const seenRequests = new Set<string>(session.wallet.requests().map((r) => r.id));

  /** Wait for the page to settle, then describe the new state plus any new wallet request. */
  const after = async (what: string): Promise<AgentToolResult> => {
    await settle(session);
    const lines = [what];
    const blocked = await detectBlock(session);
    if (blocked) lines.push(`WARNING: ${blocked}. Do not try to solve it; call report_blocked.`);
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
    return { text: lines.join("\n") };
  };

  const target = async (ref: string) => {
    const locator = await locatorFor(page(), ref);
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
          .describe("True for a one-time prompt a returning user won't see again (terms, cookie banner, onboarding, one-time trading setup). Replays skip it, and the signature it asks for, when it doesn't show."),
      }),
      handler: async ({ ref, why, optional }) => {
        const { locator, el } = await target(ref);
        const label = (await el.textContent().catch(() => null))?.trim().slice(0, 60);
        await el.click({ timeout: 5_000 });
        recorder.add({ kind: "click", target: locator, note: why ?? (label ? `Click "${label}"` : undefined), ...(optional ? { optional } : {}) });
        return after(`Clicked ${ref}.`);
      },
    },
    {
      name: "type",
      description: "Clear a field and type into it. Set enter=true to press Enter afterwards.",
      schema: z.object({ ref: z.string(), text: z.string(), enter: z.boolean().optional() }),
      handler: async ({ ref, text, enter }) => {
        const { locator, el } = await target(ref);
        await el.fill(text, { timeout: 5_000 });
        recorder.add({ kind: "fill", target: locator, value: text });
        if (enter) {
          await el.press("Enter");
          recorder.add({ kind: "press", key: "Enter", target: locator });
        }
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
        return after(`Pressed ${key}.`);
      },
    },
    {
      name: "goto",
      description: "Navigate to a URL or path on the app's own origin. Other origins are refused.",
      schema: z.object({ url: z.string() }),
      handler: async ({ url }) => {
        const abs = new URL(url, page().url());
        if (abs.origin !== origin) return `Refused: ${abs.origin} is outside the app (${origin}). Stay on the app's pages.`;
        await page().goto(abs.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
        recorder.add({ kind: "goto", url: abs.pathname + abs.search });
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
      schema: z.object({}),
      handler: async () => {
        const pending = pendingSign(session);
        if (!pending) return "No signing request is pending. Trigger one in the app first.";
        const decoded = decodeWalletRequest(pending);
        const match = matchTypedAmount(recorder.typedValues(), decoded.amounts);
        const expect = { ...decoded.expectation };
        if (match) expect.amountMustEqual = match.typed;
        recorder.add({ kind: "wallet", respond: "approve", expect, note: `Approve ${decoded.summary.split(":")[0]}` });
        await session.wallet.approve(pending.id);
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
        return after(`Typed the emailed code into ${ref}.`);
      },
    },
    {
      name: "report_blocked",
      description: "Report that a CAPTCHA, bot check or similar blocks progress. Never try to solve or bypass these.",
      schema: z.object({ reason: z.string() }),
      handler: async ({ reason }) => {
        ctx.onBlocked?.(reason);
        return `Recorded: blocked (${reason}). Stop exploring this path.`;
      },
    },
  ];
  return { tools, after };
}

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
  if (r.kind !== "sign") return `- ${r.id} ${r.method} → ${r.outcome}`;
  return `- ${r.id} ${decodeWalletRequest(r).summary} → ${r.outcome}${r.error ? ` (${r.error})` : ""}`;
}

/** Give the app a moment to react, then wait for network quiet (bounded). */
export async function settle(session: DrillSession): Promise<void> {
  await session.page.waitForTimeout(SETTLE_MS);
  await session.page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => null);
}

async function detectBlock(session: DrillSession): Promise<string | undefined> {
  const page = session.page;
  const hasFrame = page.frames().some((f) => /captcha|turnstile|challenges\.cloudflare/i.test(f.url()));
  if (hasFrame) return "A CAPTCHA / bot-check frame is on the page";
  const title = await page.title().catch(() => "");
  if (BLOCKED_PATTERNS.test(title)) return `The page title looks like a bot check ("${title}")`;
  const text = await page.evaluate(() => document.body?.innerText.slice(0, 500) ?? "").catch(() => "");
  if (BLOCKED_PATTERNS.test(text)) return "The page text looks like a CAPTCHA / bot check";
  return undefined;
}

/** Render a flow's steps for the model, one per line with indices. */
export function listSteps(steps: Step[], params: Record<string, string> = {}): string {
  return steps
    .map((s, i) => {
      const t = (l?: { name?: string; text?: string; label?: string; placeholder?: string; testId?: string; css?: string }) =>
        l ? `"${l.name ?? l.text ?? l.label ?? l.placeholder ?? l.testId ?? l.css ?? "?"}"` : "";
      let body: string;
      switch (s.kind) {
        case "goto": body = `goto ${s.url}`; break;
        case "click": body = `click ${t(s.target)}`; break;
        case "fill": body = `fill ${t(s.target)} with "${applyParams(s.value, params)}"`; break;
        case "select": body = `select "${s.value}" in ${t(s.target)}`; break;
        case "press": body = `press ${s.key}${s.target ? ` on ${t(s.target)}` : ""}`; break;
        case "wait": body = `wait ${s.until}${s.text ? ` "${s.text}"` : ""}${s.ms ? ` ${s.ms}ms` : ""}`; break;
        case "wallet": body = `wallet ${s.respond}${s.expect?.functionName ? ` ${s.expect.functionName}` : ""}${s.expect?.to ? ` to ${short(s.expect.to)}` : ""}`; break;
        case "expect": body = `expect ${s.assert.type} ${"text" in s.assert ? `"${s.assert.text}"` : s.assert.contains}`; break;
        case "email-code": body = `email-code into ${t(s.target)}`; break;
      }
      return `${i}. ${body}${s.note ? `  (${s.note})` : ""}`;
    })
    .join("\n");
}
