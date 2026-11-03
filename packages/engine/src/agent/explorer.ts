/**
 * Exploration in two parts. The thinking model surveys the app, pictures a
 * demanding user of it and plans the flows that user would perform, by level:
 * happy paths, then variants, then unusual cases. The acting model then
 * records the plan breadth first, a few flows at a time in browsers of their
 * own, until the time or flow budget runs out; a flow it can't record gets one
 * more try with the thinking model. Every recorded flow is cut into a
 * replayable core Flow.
 */
import { z } from "zod";
import { FailCause, newId, type Blocked, type Flow, type PlanItem, describeBlock } from "@dappdrill/core";
import type { AgentTool, DrillSession, Inbox, Llm } from "../types.js";
import { formatSnapshot, takeSnapshot } from "./snapshot.js";
import { browserTools, inboxTool, Recorder, settle } from "./tools.js";
import { LlmError } from "./llm-common.js";

export interface ExploreModels {
  /** Surveys the app, plans the flows and retries the ones `act` couldn't record. */
  think: Llm;
  /** Records each planned flow, step by step. */
  act: Llm;
}

export interface ExploreOptions {
  maxFlows: number;
  maxMinutes: number;
  /** Deepest plan level to record: 1 happy paths, 2 variants, 3 unusual cases (default 2). */
  depth?: 1 | 2 | 3;
  /** Free-text hints from the user ("the swap page is under /trade"). */
  hints?: string;
  /** Flows saved by earlier scans; recording one again under its name keeps its id. */
  knownFlows?: { id: string; name: string }[];
  /** Flows the user doesn't want tested, by name; the plan leaves them out. */
  skip?: string[];
  /** A plan made earlier: skips the survey and records these flows (how a single flow is retried). */
  plan?: ExplorePlan;
  signal?: AbortSignal;
  inbox?: Inbox;
  onFlow?: (flow: Flow) => void;
  /**
   * Opens another browser on the same chains with its own test accounts, so flows that don't
   * depend on each other are recorded at the same time, up to `lanes` (default 1) at once.
   */
  openLane?: () => Promise<DrillSession>;
  lanes?: number;
  /** Model turns for the survey (default 60) and for each flow (default 40). */
  surveyTurns?: number;
  flowTurns?: number;
}

export const PlannedFlow = z.object({
  name: z.string().describe("Short name like 'Open market short' or 'Withdraw USDC'"),
  level: z.number().int().min(1).max(3).describe("1 happy path, 2 variant, 3 unusual case"),
  why: z.string().describe("Why this user does it, and what could go wrong"),
  how: z.string().describe("One or two sentences: what to do and what success looks like on the page"),
  startPath: z.string().describe("Same-origin path the flow starts on, e.g. /trade"),
  dependsOn: z.array(z.string()).default([]).describe("Names of planned flows whose result this one needs (funds minted, a position opened)"),
});
export type PlannedFlow = z.infer<typeof PlannedFlow>;

export const ExplorePlan = z.object({
  profile: z.string().describe("What the app is, who uses it, where money moves and what needs a signature"),
  persona: z.string().describe("The demanding user: who they are, what they came to do, what they won't tolerate"),
  flows: z.array(PlannedFlow),
});
export type ExplorePlan = z.infer<typeof ExplorePlan>;

export type PlanOutcome = PlanItem;

export interface ExploreResult {
  pages: { url: string; title?: string }[];
  flows: Flow[];
  /** Set when a CAPTCHA / bot check stopped the exploration. */
  blocked?: Blocked;
  profile?: string;
  persona?: string;
  plan: PlanOutcome[];
  summary: string;
}

/** Share of the exploration time the survey may use; the rest records flows. */
const SURVEY_SHARE = 0.25;

const COMMON_RULES = `- Only act through the tools. Every action returns the new page state, so you rarely need look.
- Never leave the app's origin. External links (docs, social, explorers) are not worth visiting.
- If you see a CAPTCHA or bot check, call report_blocked and stop. Never try to solve or bypass it.
- Some prompts show only once per wallet because the app's server remembers them (terms, cookie banners, onboarding, one-time trading setup). Click those with optional=true so replays still work after the server remembers.
- A popup that gets in the way (a deposit prompt, onboarding, an announcement) can be closed with Escape or its top-right icon; then carry on.`;

export const SURVEY_SYSTEM = `You are DappDrill, a QA lead about to test a web3 dApp's frontend in a sandboxed browser with a test wallet (test funds, usually on a forked chain). Nothing is recorded yet: first understand the app, then plan what to test.

1. Survey: look at the landing page and open the main navigation pages (goto same-origin paths or click nav links); call note_page for each with a one-line purpose. Connect the wallet (choose MetaMask or the injected/browser wallet; connection and network switches are approved automatically) to see what a signed-in user sees. You are scouting, not testing: approve wallet requests only when you need to see what comes next, and don't spend long on any one screen.
2. Understand: what the app is, who uses it, where money moves, which actions ask for a signature or transaction.
3. Picture one demanding user of this app: someone who uses every feature they came for, checks every number, and won't tolerate a stuck button or a confusing error.
4. Call submit_plan with the profile, the persona and every flow that user would perform. Each flow is one thing they do, from opening a page as a new visitor to a result visible on the page. Give each a level:
   1. Happy paths: everything the user does in a normal session. Sign in, fund the account, every main action, and finishing what they start (close what they open, withdraw what they deposit, cancel what they place).
   2. Variants that run different code: the other side or order type, another asset or market, max or partial amounts, settings that change the transaction (leverage, slippage).
   3. Unusual cases in the app's own logic: a zero or dust amount, more than the balance, submitting twice, acting on something that is already closing. Leave out wallet rejections, wrong network, account switches, low gas and slow RPCs: every flow is tested against those automatically.
   Within a level, put the most important first. Leave out cosmetic UI (themes, language, watchlists, favourites).
   Flows are recorded several at a time on separate accounts, so a flow's dependsOn must name every flow whose result it needs (funds minted or deposited, a position opened, an order placed).

Rules:
${COMMON_RULES}
- After submit_plan, stop with a one-line reply.`;

export const FLOW_SYSTEM = `You are DappDrill, recording one flow of a web3 dApp in a sandboxed browser with a test wallet. The page was just opened as a new visitor sees it (wallet disconnected, storage cleared) and recording has started: every action you take becomes a step of the flow, and the flow is replayed later without you.

Do the flow you are given, as a real user would, with SMALL amounts (e.g. 0.01, 1, 5 or the smallest the app allows). Connect the wallet inside the flow when it needs one (choose MetaMask or the injected/browser wallet; connection and network switches are approved automatically). Approve wallet requests with wallet_approve when they belong to the flow. When the app shows that it worked, call end_flow with success=true and a short text visible on the page that proves it (e.g. "Deposited 1 USDC" or "Order placed").

Rules:
${COMMON_RULES}
- Everything runs on test funds. Approve the requests that belong to the flow even when they look wrong (an unlimited approval, a permit behind a "Sign in" button): every recorded signature is reviewed in detail afterwards, and that review is how the problem gets reported. Reject only when the flow is about rejecting.
- Stick to the flow you were given. Don't wander into other features.
- If the flow can't be done, call end_flow with success=false, a cause and the reason: one short sentence (under 25 words) the app's owner would understand, e.g. "The order was confirmed but never appeared under Orders." cause "app": the app itself misbehaves (an error, a confirmed action that never shows up, wrong numbers). cause "setup": the test environment can't do it (no test funds, a rate limit, the wallet has no key for that chain). cause "unsure": you couldn't work out how. Don't record something else instead, and don't spend more than a few actions on something that isn't working.
- After end_flow, stop with a one-line reply.`;

/**
 * Replays start in a new browser with nothing connected, so each flow is
 * recorded from the same state: storage cleared, wallet disconnected, page (re)loaded.
 */
async function freshVisit(session: DrillSession, url?: string): Promise<void> {
  await session.wallet.disconnect();
  await session.context.clearCookies();
  await session.page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => {});
  if (url) await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  else await session.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(session);
}

function isLive(session: DrillSession): boolean {
  const chain = session.wallet.chainId();
  return session.chains.has(chain) && session.chains.mode(chain) === "live";
}

/** A browser with its own test accounts that records planned flows one at a time. */
interface Lane {
  session: DrillSession;
  recorder: Recorder;
  /** Browser tools, for the survey. */
  browse: AgentTool[];
  /** Browser tools plus end_flow, for recording. */
  tools: AgentTool[];
  saved?: Flow;
  failure?: { reason: string; cause: FailCause };
  /** Flows recorded here; what they left behind (balances, positions) is on this lane's accounts. */
  recorded: string[];
}

export async function explore(session: DrillSession, models: ExploreModels, opts: ExploreOptions): Promise<ExploreResult> {
  const flows: Flow[] = [];
  const pages = new Map<string, { url: string; title?: string }>();
  const deadline = Date.now() + opts.maxMinutes * 60_000;
  const surveyDeadline = Date.now() + opts.maxMinutes * SURVEY_SHARE * 60_000;
  const depth = opts.depth ?? 2;
  // The app may have redirected to another domain; flows start on the one it landed on.
  const home = session.page.url().startsWith("http") ? session.page.url() : session.target.url;
  let blocked: Blocked | undefined;
  let plan: ExplorePlan | undefined = opts.plan;
  let surveying = !plan;
  const log = (message: string, level: "info" | "warn" = "info") => session.emit({ type: "log", level, message, at: new Date().toISOString() });
  const skip = new Set(opts.skip?.map((n) => n.toLowerCase()));
  const llms = [...new Set([models.think, models.act])];
  const costBefore = llms.reduce((sum, l) => sum + l.costUsd(), 0);

  // Keyed by path: navigation and note_page see the same page with and without its query.
  const notePage = async (url: string, title?: string) => {
    const u = new URL(url, session.target.url);
    const key = u.origin + u.pathname;
    const known = pages.get(key);
    if (known && (known.title || !title)) return;
    const page = { url: known?.url ?? u.href.replace(/#.*$/, ""), title };
    pages.set(key, page);
    await session.emit({ type: "page", ...page });
  };

  let missingLogged = false;
  const missingChain = () => {
    const missing = session.chains.missing();
    if (!missing.length) return undefined;
    const what = missing.map((c) => `${c.name ? `${c.name} (chain ${c.chainId})` : `chain ${c.chainId}`}: ${c.reason}`).join("; ");
    if (!missingLogged) {
      missingLogged = true;
      void log(`The wallet couldn't add a chain the app asked for (${what}); stopping exploration`, "warn");
    }
    return what;
  };
  /** Why exploring must stop now, if it must. */
  const stopReason = () => {
    if (blocked) return "blocked";
    if (opts.signal?.aborted) return "stopped";
    if (missingChain()) return "a chain the app needs is missing";
    if (Date.now() >= deadline) return "time ran out";
    if (flows.length >= opts.maxFlows) return "the flow limit was reached";
    return undefined;
  };
  const budgetNote = (lane: Lane) => {
    if (blocked) return "Exploration is blocked; finish with a one-line reply.";
    const missing = missingChain();
    if (missing) return `The test wallet couldn't add a chain the app needs (${missing}), so it can't be tested here. ${surveying ? "Call submit_plan with what you know" : "Call end_flow with success=false"} and stop.`;
    if (surveying) {
      if (plan) return "The plan is saved; stop with a one-line reply.";
      if (Date.now() >= surveyDeadline) return "Survey time is up: call submit_plan now with what you know.";
      return undefined;
    }
    if (lane.saved) return "The flow is saved; stop with a one-line reply.";
    const left = Math.round((deadline - Date.now()) / 1000);
    if (left <= 0) return "Time is up. Call end_flow (success=false if it isn't done) and stop.";
    if (left < 90) return `About ${left}s left. Finish this flow quickly.`;
    return undefined;
  };

  const endFlow = (lane: Lane): AgentTool => ({
    name: "end_flow",
    description: "Finish the flow. Pass success=true with a short text visible on the page that proves it worked, or success=false with the cause and the reason it couldn't be done.",
    schema: z.object({ success: z.boolean(), successText: z.string().optional(), cause: FailCause.optional(), reason: z.string().optional() }),
    handler: async ({ success, successText, cause, reason }: { success: boolean; successText?: string; cause?: FailCause; reason?: string }) => {
      const { recorder } = lane;
      if (!recorder.recording()) return "No flow is being recorded.";
      if (!success) {
        recorder.discard();
        lane.failure = { reason: reason?.trim().replace(/\.+$/, "") || "it couldn't be done", cause: cause ?? "unsure" };
        return `Noted: ${lane.failure.reason}. Stop now with a one-line reply.`;
      }
      if (successText) {
        await settle(lane.session);
        const visible = await lane.session.page.getByText(successText, { exact: false }).first().isVisible().catch(() => false);
        if (!visible) return `"${successText}" is not visible on the page right now. Pick text that is actually shown, or pass success=false.`;
        recorder.add({ kind: "expect", assert: { type: "visible", text: successText } });
      }
      const rec = recorder.end()!;
      if (rec.steps.filter((s) => s.kind !== "expect").length === 0) {
        lane.failure = { reason: "the flow had no actions", cause: "unsure" };
        return "The flow has no actions; discarded. Stop now with a one-line reply.";
      }
      const known = opts.knownFlows?.find((k) => k.name.toLowerCase() === rec.name.toLowerCase() && !flows.some((f) => f.id === k.id));
      lane.saved = { id: known?.id ?? newId("flow"), name: rec.name, origin: "discovered", startUrl: rec.startUrl, params: rec.params, steps: rec.steps, chainId: rec.chainId };
      return `Saved "${rec.name}" with ${rec.steps.length} steps${rec.params.length ? ` and params ${rec.params.map((p) => p.name).join(", ")}` : ""}. Stop now with a one-line reply.`;
    },
  });

  /** Tools are built on the page the lane is on, so open the app in it first. */
  const newLane = (s: DrillSession): Lane => {
    const lane: Lane = { session: s, recorder: new Recorder(s), browse: [], tools: [], recorded: [] };
    lane.browse = [
      ...browserTools({ session: s, recorder: lane.recorder, inbox: opts.inbox, budgetNote: () => budgetNote(lane), onBlocked: (b) => { blocked = b; void log(`${describeBlock(b)}: ${b.reason}`, "warn"); } }),
      ...(opts.inbox ? [inboxTool(opts.inbox)] : []),
    ];
    lane.tools = [...lane.browse, endFlow(lane)];
    s.page.on("framenavigated", (f) => {
      if (f === s.page.mainFrame()) void notePage(f.url());
    });
    return lane;
  };
  const main = newLane(session);
  const lanes = [main];

  const surveyTools: AgentTool[] = [
    ...main.browse,
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
      name: "submit_plan",
      description: "Save the app profile, the demanding user and the flows they would perform. Call once, at the end of the survey.",
      schema: ExplorePlan,
      handler: async (p: ExplorePlan) => {
        plan = p;
        return `Plan saved: ${p.flows.length} flows. Stop now with a one-line reply.`;
      },
    },
  ];

  const context = [
    `App under test: ${session.target.url}`,
    isLive(session)
      ? "This chain is a live testnet, not a fork: state persists between runs and replays, so success text must not contain balances or amounts that change (prefer \"Order placed\" over \"$10,000.00\")."
      : "",
    opts.hints ? `Hints from the user: ${opts.hints}` : "",
  ];

  /** Run one agent loop; an aborted run ends quietly, anything else is the caller's problem. */
  const run = async (llm: Llm, system: string, prompt: string, tools: AgentTool[], maxTurns: number, label?: string) => {
    try {
      const res = await llm.runAgent({ system, prompt, tools, maxTurns, signal: opts.signal, onText: (t) => void log(`${label ? `${label}: ` : ""}${t.length > 300 ? t.slice(0, 300) + "…" : t}`) });
      return res.stopReason === "max_turns" ? "it ran out of turns" : undefined;
    } catch (err) {
      if (err instanceof LlmError && err.code === "aborted") return "stopped";
      throw err;
    }
  };

  try {
    // 1. Survey and plan with the thinking model.
    await notePage(session.page.url(), await session.page.title().catch(() => undefined));
    if (surveying) await survey();
    if (!plan) {
      if (!blocked && !opts.signal?.aborted) await log("The survey ended without a plan, so no flows were recorded", "warn");
      return finish([]);
    }
    const left = plan.flows.filter((f) => !skip.has(f.name.toLowerCase()));
    if (left.length < plan.flows.length) await log(`Leaving out ${plan.flows.length - left.length} planned flow(s) you chose not to test`);
    plan = { ...plan, flows: left };
    await log(`Testing as: ${plan.persona}`);
    for (const level of [1, 2, 3]) {
      const names = plan.flows.filter((f) => f.level === level).map((f) => f.name);
      if (names.length) await log(`Plan, level ${level}${level > depth ? " (beyond the depth set for this scan)" : ""}: ${names.join(", ")}`);
    }

    // 2. Record the plan breadth first with the acting model, in parallel lanes when it can.
    const outcomes: PlanOutcome[] = plan.flows.map((f) => ({ ...f, outcome: "not reached" }));
    const emitPlan = () => session.emit({ type: "plan", plan: { profile: plan!.profile, persona: plan!.persona, items: outcomes.filter((o) => o.level <= depth).map((o) => ({ ...o })) } });
    await emitPlan();
    const pending = outcomes.filter((o) => o.level <= depth).sort((a, b) => a.level - b.level);
    const total = pending.length;
    // Flows that build on each other share a lane, so the state they need is on its accounts.
    const group = dependencyGroups(pending);
    const owner = new Map<number, Lane>();
    // A live chain has one funded key and an inbox one address, so those can't be shared out.
    const shareable = !opts.inbox && !session.chains.configs().some((c) => c.mode === "live");
    const want = shareable && opts.openLane ? Math.min(opts.lanes ?? 1, new Set(group.values()).size) : 1;
    if (want > 1) lanes.push(...(await openLanes(want - 1)));
    if (lanes.length > 1) await log(`Recording ${lanes.length} flows at a time, each in its own browser with its own test accounts`);

    let started = 0;
    let inFlight = 0;
    const work = async (lane: Lane) => {
      for (;;) {
        const at = pending.findIndex((item) => {
          const o = owner.get(group.get(item.name)!);
          return !o || o === lane;
        });
        if (at < 0) return;
        const item = pending.splice(at, 1)[0]!;
        owner.set(group.get(item.name)!, lane);
        const stop = stopReason() ?? (flows.length + inFlight >= opts.maxFlows ? "the flow limit was reached" : undefined);
        if (stop) {
          item.note = stop;
          continue;
        }
        const unmet = item.dependsOn.filter((d) => outcomes.some((o) => o.name === d && o.outcome !== "recorded"));
        if (unmet.length) {
          item.outcome = "skipped";
          item.note = `needs ${unmet.map((d) => `“${d}”`).join(" and ")}, which wasn't recorded`;
          await log(`Skipping “${item.name}”: it ${item.note}`, "warn");
          continue;
        }
        await log(`Recording flow ${++started}/${total} (level ${item.level}): ${item.name}`);
        inFlight++;
        try {
          await attempt(lane, item);
        } finally {
          inFlight--;
        }
        await emitPlan();
      }
    };
    const settled = await Promise.allSettled(lanes.map(work));
    const err = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (err) throw err.reason;
    await emitPlan();
    return finish(outcomes);
  } finally {
    for (const lane of lanes) if (lane.recorder.recording()) lane.recorder.discard();
    await Promise.all(lanes.slice(1).map((l) => l.session.close().catch(() => {})));
    await session.emit({ type: "cost", usd: llms.reduce((sum, l) => sum + l.costUsd(), 0) - costBefore });
  }

  async function survey(): Promise<void> {
    await log("Surveying the app to plan what to test");
    const surveyPrompt = [
      ...context,
      `Wallet: ${session.wallet.address()} on chain ${session.wallet.chainId()}.`,
      `Survey budget: about ${Math.round(opts.maxMinutes * SURVEY_SHARE)} minutes. Recording happens afterwards, up to ${opts.maxFlows} flows.`,
      opts.knownFlows?.length
        ? `Flows saved by earlier scans: ${opts.knownFlows.map((f) => `"${f.name}"`).join(", ")}. Use exactly that name for any that is still something your user does.`
        : "",
      opts.skip?.length ? `The user doesn't want these tested, so leave them out of the plan: ${opts.skip.map((n) => `"${n}"`).join(", ")}.` : "",
      "Start by calling look.",
    ].filter(Boolean).join("\n");
    const surveyEnd = await run(models.think, SURVEY_SYSTEM, surveyPrompt, surveyTools, opts.surveyTurns ?? 60);
    surveying = false;
    if (!plan && !blocked && !opts.signal?.aborted) plan = await planFromNotes(models.think, surveyPrompt, [...pages.values()], surveyEnd).catch(() => undefined);
  }

  /** Extra lanes for recording; one that won't open just means fewer at a time. */
  async function openLanes(n: number): Promise<Lane[]> {
    const opened = await Promise.allSettled(
      Array.from({ length: n }, async () => {
        const s = await opts.openLane!();
        try {
          await s.page.goto(home, { waitUntil: "domcontentloaded", timeout: 45_000 });
        } catch (e) {
          await s.close().catch(() => {});
          throw e;
        }
        return newLane(s);
      }),
    );
    const ok = opened.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (ok.length < n) await log(`Couldn't open ${n - ok.length} more browser(s), so fewer flows are recorded at a time`, "warn");
    return ok;
  }

  /** Record a planned flow in a lane, retrying with the thinking model when the acting one couldn't work out how. */
  async function attempt(lane: Lane, item: PlanOutcome): Promise<void> {
    const label = lanes.length > 1 ? item.name : undefined;
    let failed = await recordPlanned(lane, item, models.act, label);
    // A clear cause (the app misbehaved, the setup can't do it) won't change with a stronger model.
    if (failed?.cause === "unsure" && !stopReason() && models.think !== models.act) {
      await log(`Couldn't record “${item.name}” (${failed.reason}); trying again with the thinking model`, "warn");
      failed = await recordPlanned(lane, item, models.think, label, failed.reason);
    }
    const saved = lane.saved;
    if (saved) {
      flows.push(saved);
      lane.recorded.push(saved.name);
      opts.onFlow?.(saved);
      await session.emit({ type: "flow", flow: saved });
      await log(`Recorded flow "${saved.name}" (${saved.steps.length} steps)`);
      item.outcome = "recorded";
      item.flowId = saved.id;
    } else if (opts.signal?.aborted || blocked) {
      // Cut off, not failed.
      item.note = stopReason();
    } else {
      item.outcome = "failed";
      item.note = failed?.reason;
      item.cause = failed?.cause;
      await log(`Couldn't record “${item.name}”: ${failed?.reason}`, "warn");
    }
  }

  /** Record one planned flow from a fresh visit. Returns why it wasn't saved, if it wasn't. */
  async function recordPlanned(lane: Lane, item: PlannedFlow, llm: Llm, label?: string, earlierFailure?: string): Promise<{ reason: string; cause: FailCause } | undefined> {
    lane.saved = undefined;
    lane.failure = undefined;
    const { session: s, recorder } = lane;
    const start = new URL(item.startPath, home);
    await freshVisit(s, start.origin === new URL(home).origin ? start.href : home);
    recorder.start(item.name);
    const done = lane.recorded.map((n) => `"${n}"`).join(", ");
    const prompt = [
      ...context,
      `About the app: ${plan!.profile}`,
      `You are: ${plan!.persona}`,
      `Flow to record: "${item.name}". ${item.how}`,
      `Why it matters: ${item.why}`,
      done ? `Already recorded (state such as balances and positions carries over, but each flow starts disconnected): ${done}.` : "",
      earlierFailure ? `An earlier attempt failed: ${earlierFailure}. Look carefully for another way before giving up.` : "",
      `Recording started on ${s.page.url()}.`,
      "",
      formatSnapshot(await takeSnapshot(s.page)),
    ].filter((l) => l !== "").join("\n");
    const end = await run(llm, FLOW_SYSTEM, prompt, lane.tools, opts.flowTurns ?? 40, label);
    if (recorder.recording()) recorder.discard();
    if (lane.saved) return undefined;
    return lane.failure ?? { reason: end ?? "it ended without finishing the flow", cause: "unsure" };
  }

  function finish(outcomes: PlanOutcome[]): ExploreResult {
    const recorded = outcomes.filter((o) => o.outcome === "recorded").length;
    const missed = outcomes.filter((o) => o.outcome !== "recorded" && o.level <= depth);
    const summary = [
      outcomes.length ? `Recorded ${recorded} of ${outcomes.filter((o) => o.level <= depth).length} planned flows.` : "No plan, so no flows were recorded.",
      ...missed.map((o) => `“${o.name}” ${o.outcome}${o.note ? `: ${o.note.replace(/\.+$/, "")}` : ""}.`),
    ].join(" ");
    return { pages: [...pages.values()], flows, blocked, profile: plan?.profile, persona: plan?.persona, plan: outcomes, summary };
  }
}

/** Flows linked by dependsOn, either way, share a group number: one lane records them, in order. */
function dependencyGroups(items: PlannedFlow[]): Map<string, number> {
  const group = new Map(items.map((f, i) => [f.name, i]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of items) {
      for (const d of f.dependsOn) {
        const a = group.get(f.name)!;
        const b = group.get(d);
        if (b === undefined || a === b) continue;
        const [from, to] = [Math.max(a, b), Math.min(a, b)];
        for (const [name, g] of group) if (g === from) group.set(name, to);
        changed = true;
      }
    }
  }
  return group;
}

/** The survey ended without submit_plan: ask for the plan from what it saw. */
async function planFromNotes(llm: Llm, surveyPrompt: string, pages: { url: string; title?: string }[], ended?: string): Promise<ExplorePlan> {
  return llm.structured({
    system: SURVEY_SYSTEM,
    prompt: [
      surveyPrompt,
      `The survey ended${ended ? ` (${ended})` : ""} before submit_plan. Pages seen:`,
      ...pages.map((p) => `- ${p.url}${p.title ? `: ${p.title}` : ""}`),
      "Write the plan now from what you know.",
    ].join("\n"),
    schema: ExplorePlan,
    name: "plan",
  });
}
