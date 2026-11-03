/**
 * Autonomous exploration: the model maps the app, connects the wallet and
 * completes the value flows it finds (deposit, swap, claim…) with small
 * amounts. Every completed flow is cut into a replayable core Flow.
 */
import { z } from "zod";
import { newId, type Flow } from "@dappdrill/core";
import type { DrillSession, Inbox, Llm } from "../types.js";
import { formatSnapshot, takeSnapshot } from "./snapshot.js";
import { browserTools, inboxTool, Recorder, settle } from "./tools.js";
import { LlmError } from "./llm-common.js";

export interface ExploreOptions {
  maxFlows: number;
  maxMinutes: number;
  /** Free-text hints from the user ("the swap page is under /trade"). */
  hints?: string;
  signal?: AbortSignal;
  inbox?: Inbox;
  onFlow?: (flow: Flow) => void;
  /** Model turns per exploration run (default 80). */
  maxTurns?: number;
}

export interface ExploreResult {
  pages: { url: string; title?: string }[];
  flows: Flow[];
  /** Set when a CAPTCHA / bot check stopped the exploration. */
  blocked?: string;
  summary: string;
}

export const EXPLORER_SYSTEM = `You are DappDrill, a QA engineer testing a web3 dApp's frontend in a sandboxed browser with a test wallet (forked chain, test funds). Your job: discover what a user can do here and record each valuable flow so it can be replayed later.

Strategy:
1. Map the app: look at the landing page, open the main navigation pages (goto with same-origin paths or click nav links). Call note_page for each distinct page you visit with a one-line purpose.
2. Connect the wallet: find the Connect button, choose MetaMask (or the injected/browser wallet). Connection and network switches are approved automatically.
3. Complete value flows one at a time: deposit, stake, swap, mint, claim, withdraw, sign-in, etc. Use SMALL amounts (e.g. 0.01, 1, 5). For each flow:
   - call start_flow with a short name BEFORE the first action that belongs to it (navigate to the page first, then start),
   - perform the steps (type amounts, click buttons, approve wallet requests with wallet_approve when they appear and look right),
   - wait for the app's success state, then call end_flow with a short text visible on the page that proves success (e.g. "Deposited 1 USDC" or "Rewards claimed"). If the flow failed, call end_flow with success=false.
4. Keep flows independent: start_flow reloads the current page as a new visitor would see it (wallet disconnected, storage cleared), so connect the wallet inside the flow when it needs one. Chain state (balances, deposits) carries over between flows. Do not record exploration clicks inside a flow.

Rules:
- Only act through the tools. Every action returns the new page state, so you rarely need look.
- Never leave the app's origin. External links (docs, social, explorers) are not worth visiting.
- If you see a CAPTCHA or bot check, call report_blocked and stop. Never try to solve or bypass it.
- Everything runs on a disposable fork with test funds. Approve the wallet requests that belong to the flow even when they look wrong (an unlimited approval, a permit behind a "Sign in" button): every recorded signature is reviewed in detail afterwards, and that review is how the problem gets reported. If a request does not match what you did, still approve it, finish the flow, and say what looked wrong in your final summary. Reject only to test a rejection.
- Do not spend more than a few actions on something that is not working; move on.
- When you have recorded the flows you can or run out of budget, reply with a short summary of pages, flows recorded, and anything broken you noticed.`;

/**
 * Replays start in a new browser with nothing connected, so each flow is
 * recorded from the same state: storage cleared, wallet disconnected, page reloaded.
 */
async function freshVisit(session: DrillSession): Promise<void> {
  await session.wallet.disconnect();
  await session.context.clearCookies();
  await session.page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => {});
  await session.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(session);
}

function isLive(session: DrillSession): boolean {
  const chain = session.wallet.chainId();
  return session.chains.has(chain) && session.chains.mode(chain) === "live";
}

export async function explore(session: DrillSession, llm: Llm, opts: ExploreOptions): Promise<ExploreResult> {
  const recorder = new Recorder(session);
  const flows: Flow[] = [];
  const pages = new Map<string, { url: string; title?: string }>();
  const deadline = Date.now() + opts.maxMinutes * 60_000;
  let blocked: string | undefined;
  const log = (message: string, level: "info" | "warn" = "info") => session.emit({ type: "log", level, message, at: new Date().toISOString() });

  const notePage = async (url: string, title?: string) => {
    const key = new URL(url, session.target.url).href.replace(/#.*$/, "");
    if (pages.has(key)) return;
    pages.set(key, { url: key, title });
    await session.emit({ type: "page", url: key, title });
  };
  session.page.on("framenavigated", (f) => {
    if (f === session.page.mainFrame()) void notePage(f.url());
  });

  const budgetNote = () => {
    if (blocked) return "Exploration is blocked; finish with a summary.";
    if (flows.length >= opts.maxFlows) return `You have recorded ${flows.length} flows (the limit). Finish with a summary.`;
    const left = Math.round((deadline - Date.now()) / 1000);
    if (left <= 0) return "Time is up. End the current flow and finish with a summary.";
    if (left < 90) return `About ${left}s left. Wrap up.`;
    return undefined;
  };

  const tools = [
    ...browserTools({ session, recorder, inbox: opts.inbox, budgetNote, onBlocked: (r) => { blocked = r; log(`Blocked: ${r}`, "warn"); } }),
    ...(opts.inbox ? [inboxTool(opts.inbox)] : []),
    {
      name: "note_page",
      description: "Record a page of the app you have seen, with its purpose.",
      schema: z.object({ url: z.string(), purpose: z.string() }),
      handler: async ({ url, purpose }: { url: string; purpose: string }) => {
        await notePage(url, purpose);
        return `Noted ${url}: ${purpose}`;
      },
    },
    {
      name: "start_flow",
      description: "Start recording a flow from the current page. Call before the first action that belongs to the flow.",
      schema: z.object({ name: z.string().describe("Short name like 'Deposit USDC' or 'Claim rewards'") }),
      handler: async ({ name }: { name: string }) => {
        if (recorder.recording()) recorder.discard();
        await freshVisit(session);
        recorder.start(name);
        log(`Recording flow: ${name}`);
        return `Recording "${name}" from ${session.page.url()}. The page was reloaded as a new visitor sees it, with the wallet disconnected. Perform the steps, then call end_flow.\n\n${formatSnapshot(await takeSnapshot(session.page))}`;
      },
    },
    {
      name: "end_flow",
      description: "Finish the flow being recorded. Pass success=true with a short text visible on the page that proves it worked; success=false discards it. Pass name to rename the flow when what you did differs from the plan.",
      schema: z.object({ success: z.boolean(), successText: z.string().optional(), name: z.string().optional(), reason: z.string().optional() }),
      handler: async ({ success, successText, name, reason }: { success: boolean; successText?: string; name?: string; reason?: string }) => {
        if (!recorder.recording()) return "No flow is being recorded.";
        if (!success) {
          recorder.discard();
          log(`Flow discarded: ${reason ?? "failed"}`, "warn");
          return `Discarded. ${reason ?? ""}`.trim();
        }
        if (successText) {
          await settle(session);
          const visible = await session.page.getByText(successText, { exact: false }).first().isVisible().catch(() => false);
          if (!visible) return `"${successText}" is not visible on the page right now. Pick text that is actually shown, or pass success=false.`;
          recorder.add({ kind: "expect", assert: { type: "visible", text: successText } });
        }
        const rec = recorder.end()!;
        if (rec.steps.filter((s) => s.kind !== "expect").length === 0) return "The flow has no actions; discarded.";
        const flow: Flow = { id: newId("flow"), name: name?.trim() || rec.name, origin: "discovered", startUrl: rec.startUrl, params: rec.params, steps: rec.steps, chainId: rec.chainId };
        flows.push(flow);
        opts.onFlow?.(flow);
        await session.emit({ type: "flow", flow });
        log(`Recorded flow "${flow.name}" (${flow.steps.length} steps)`);
        return `Saved "${flow.name}" with ${flow.steps.length} steps${rec.params.length ? ` and params ${rec.params.map((p) => p.name).join(", ")}` : ""}. ${flows.length}/${opts.maxFlows} flows recorded.`;
      },
    },
  ];

  await notePage(session.page.url(), await session.page.title().catch(() => undefined));
  const prompt = [
    `App under test: ${session.target.url}`,
    `Wallet: ${session.wallet.address()} on chain ${session.wallet.chainId()}.`,
    `Budget: up to ${opts.maxFlows} flows, about ${opts.maxMinutes} minutes.`,
    isLive(session)
      ? "This chain is a live testnet, not a fork: state persists between runs and replays, so the end_flow success text must not contain balances or amounts that change (prefer \"Order placed\" over \"$10,000.00\")."
      : "",
    opts.hints ? `Hints from the user: ${opts.hints}` : "",
    "Start by calling look.",
  ].filter(Boolean).join("\n");

  const before = llm.costUsd();
  let summary = "";
  try {
    const res = await llm.runAgent({
      system: EXPLORER_SYSTEM,
      prompt,
      tools,
      maxTurns: opts.maxTurns ?? 80,
      signal: opts.signal,
      onText: (t) => log(t.length > 300 ? t.slice(0, 300) + "…" : t),
    });
    summary = res.text;
    if (res.stopReason === "max_turns") log("Exploration stopped: turn limit reached", "warn");
  } catch (err) {
    if (err instanceof LlmError && err.code === "aborted") log("Exploration aborted", "warn");
    else throw err;
  } finally {
    await session.emit({ type: "cost", usd: llm.costUsd() - before });
  }
  if (recorder.recording()) recorder.discard();
  return { pages: [...pages.values()], flows, blocked, summary };
}
