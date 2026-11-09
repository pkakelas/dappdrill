/**
 * Public engine API. The worker and the CLI only use these functions, so the
 * engine runs the same with or without a database.
 *
 * - analyze: look around the app and propose 3-5 happy-path tests, what else it saw, and a setup if every test needs one.
 * - runTests: run tests (after the app's setup); cached actions first, the fast model when they break.
 * - writeTest: write or fork a test from a sentence.
 * - chatTurn: one answer from the assistant in the side panel.
 * - explore: one pass over the app: map it, give each feature an explorer, prove what works as tests and settle the bugs.
 */
import {
  DrillTarget,
  stalledLine,
  blockedLine,
  type AppMap,
  type Blocked,
  type ChainConfig,
  type DrillEventSink,
  type SetupDraft,
  type Stalled,
  type TestDraft,
  type TestIdea,
} from "@dappdrill/core";
import { analyzeApp } from "./agent/analyst.js";
import { browseTask, chat, type ChatInput } from "./agent/chat.js";
import { createLlm } from "./agent/index.js";
import { draftTest, type DraftInput } from "./agent/writer.js";
import { diagnoseStall } from "./browser/traffic.js";
import { runExploration, type ExploreHooks, type ExploreOptions, type ExploreOutput, type KnownBug, type KnownTest } from "./explore/run.js";
import { openEnv, withoutFallback, type Env } from "./pipeline/env.js";
import { pin } from "./pipeline/pin.js";
import { landingBotCheck, runTestItems, type RunTestsOptions, type TestHooks, type TestItem, type TestOutcome } from "./pipeline/tests.js";
import { createSession, type EngineSession } from "./runtime.js";
import type { Llm } from "./types.js";

export type { TestItem, TestOutcome, TestHooks, DraftInput, ExploreHooks, ExploreOptions, ExploreOutput, KnownBug, KnownTest };

const debug = (m: string) => {
  if (process.env.DAPPDRILL_DEBUG) console.error(`[engine] ${m}`);
};

export interface AnalyzeOutput {
  map?: AppMap;
  /** Steps every test needs first, when the app has any. */
  setup?: SetupDraft;
  tests: TestDraft[];
  /** Seen but not written: a name and a goal. */
  untested: TestIdea[];
  /** Chains the app used, including ones it asked the wallet for. */
  chains: ChainConfig[];
  blocked?: Blocked;
  stalled?: Stalled;
  costUsd: number;
}

/** Look around the app for about two minutes. Logs and live frames go to `sink`. */
export async function analyze(
  target: DrillTarget,
  opts: { artifactsDir: string; hints?: string; known?: string[]; maxMs?: number; headless?: boolean },
  sink: DrillEventSink,
  signal?: AbortSignal,
): Promise<AnalyzeOutput> {
  const env = await openEnv(DrillTarget.parse(target), sink, { headless: opts.headless });
  const restore = await pin(env);
  const session = await createSession(env.target, env.chains, { artifactsDir: opts.artifactsDir, sink: env.sink, headless: env.headless, video: false, trace: false, log: debug });
  let out: Omit<AnalyzeOutput, "chains" | "costUsd"> = { tests: [], untested: [] };
  try {
    await env.log(`Opening ${env.target.url}`);
    await session.page.goto(env.target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // A challenge on the first page stops before anything is spent on the model.
    const blocked = await landingBotCheck(session);
    out = blocked
      ? { tests: [], untested: [], blocked }
      : await analyzeApp(session, env.thinkLlm(), {
          maxMs: opts.maxMs,
          hints: opts.hints,
          known: opts.known,
          inbox: env.inbox,
          signal,
          onNote: (text) => void env.log(text),
        });
    if (out.blocked) {
      await env.log(blockedLine(out.blocked), "warn");
    } else if (out.tests.length === 0 && !signal?.aborted) {
      // Nothing to test usually means the app's data never loaded; say what it was waiting on.
      const missing = env.chains.missing();
      const waiting = diagnoseStall(session.traffic, session.rpc, env.chains.configs().map((c) => c.id));
      const stalled = missing.length ? { backends: [], rpc: [], ...waiting, chains: missing } : waiting;
      if (stalled) {
        out = { ...out, stalled };
        await env.log(stalledLine(stalled), "warn");
      }
    }
  } finally {
    await session.close().catch(() => {});
    await restore();
    await env.close();
  }
  return { ...out, chains: withoutFallback(env.chains.configs()), costUsd: env.costUsd() };
}

/** Run tests one after another on one set of forks, each on pinned state. */
export async function runTests(
  target: DrillTarget,
  items: TestItem[],
  opts: RunTestsOptions & { headless?: boolean },
  hooks: TestHooks,
  sink: DrillEventSink = () => {},
): Promise<{ outcomes: TestOutcome[]; chains: ChainConfig[]; costUsd: number }> {
  const env = await openEnv(DrillTarget.parse(target), sink, { headless: opts.headless });
  try {
    const outcomes = await runTestItems(env, items, opts, hooks);
    return { outcomes, chains: withoutFallback(env.chains.configs()), costUsd: env.costUsd() };
  } finally {
    await env.close();
  }
}

/** One pass over the app, for at most `budgetMinutes` of exploring (three times that on a live chain, where explorers go one at a time). It ends sooner when nothing new turns up. */
export async function explore(target: DrillTarget, opts: ExploreOptions, hooks: ExploreHooks, sink: DrillEventSink, signal?: AbortSignal): Promise<ExploreOutput> {
  return runExploration(DrillTarget.parse(target), opts, hooks, sink, signal);
}

/** Write a new test, a fork of one, or a rewrite, from the developer's sentence. */
export async function writeTest(input: DraftInput): Promise<{ draft: TestDraft; costUsd: number }> {
  const llm = createLlm({ role: "fast" });
  const draft = await draftTest(llm, input);
  return { draft, costUsd: llm.costUsd() };
}

/**
 * One assistant answer. The browser opens only if the assistant asks to look
 * at the app, and stays open for the rest of this answer.
 */
export async function chatTurn(
  target: DrillTarget,
  input: Omit<ChatInput, "browse" | "appUrl">,
  opts: { artifactsDir: string; headless?: boolean },
): Promise<{ text: string; costUsd: number }> {
  const llm = createLlm({ role: "fast" });
  let browser: { env: Env; session: EngineSession } | undefined;
  const browse = async (task: string) => {
    if (!browser) {
      const env = await openEnv(DrillTarget.parse(target), () => {}, { headless: opts.headless });
      const session = await createSession(env.target, env.chains, { artifactsDir: opts.artifactsDir, sink: () => {}, headless: env.headless, video: false, trace: false, frameIntervalMs: 0, log: debug });
      await session.page.goto(env.target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      browser = { env, session };
    }
    return browseTask(browser.session, llm, task, { map: input.map, inbox: browser.env.inbox, signal: input.signal });
  };
  try {
    const text = await chat(llm, { ...input, appUrl: target.url, browse });
    return { text, costUsd: llm.costUsd() + (browser?.env.costUsd() ?? 0) };
  } finally {
    await browser?.session.close().catch(() => {});
    await browser?.env.close();
  }
}

export type { Llm };
