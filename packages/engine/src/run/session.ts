/** Opening a browser session in an engine call's environment. */
import path from "node:path";
import { newId, type Blocked, type DrillEvent } from "@dappdrill/core";
import { cloudflareTrace, detectBotCheck } from "../browser/access.js";
import { createSession, type EngineSession, type SessionOptions } from "../runtime.js";
import type { Env } from "./env.js";

export const debug = (m: string) => {
  if (process.env.DAPPDRILL_DEBUG) console.error(`[engine] ${m}`);
};

/**
 * A session whose live frames, and what a model does in it, go to the caller's sink. Several sessions with their own artifacts
 * may be open under one sink, so a frame's path is the whole path of the file.
 */
export function openSession(env: Env, artifactsDir: string, extra: Partial<SessionOptions> = {}): Promise<EngineSession> {
  return createSession(env.target, env.chains, {
    artifactsDir,
    headless: env.headless,
    runId: newId("run"),
    log: debug,
    sink: async (e: DrillEvent) => {
      if (e.type === "frame") await env.sink({ ...e, path: path.join(artifactsDir, e.path) });
      else if (e.type === "did" || (e.type === "log" && e.level !== "info")) await env.sink(e);
    },
    ...extra,
  });
}

/** Challenges often load a moment after the page; look twice before calling the page clean. */
export async function landingBotCheck(session: EngineSession): Promise<Blocked | undefined> {
  const first = await detectBotCheck(session.page);
  if (first) return withTrace(session, first);
  await session.page.waitForTimeout(2_500);
  const again = (await detectBotCheck(session.page)) ?? (await emptyPage(session));
  return again && withTrace(session, again);
}

/** Names Cloudflare's edge and sliver on a Cloudflare block, so "did a fix work" is visible per run. */
async function withTrace(session: EngineSession, block: Blocked): Promise<Blocked> {
  if (block.provider !== "Cloudflare") return block;
  const trace = await cloudflareTrace(session.page).catch(() => undefined);
  return trace ? { ...block, reason: `${block.reason} (${trace})` } : block;
}

export const EMPTY_PAGE = "The app's page stayed empty, so nothing could be tried on it.";
/** How long a page with nothing on it gets to draw something. */
const EMPTY_FOR_MS = 10_000;

/**
 * A page that stays empty (a 404 from a dev server that lost its files, an app that crashed while loading)
 * leaves nothing to try. A model sent to work on it only spends money, so it is reported before any line.
 */
async function emptyPage(session: EngineSession): Promise<Blocked | undefined> {
  const drawn = () => session.page.evaluate(() => (document.body?.innerText.trim().length ?? 0) > 0 || !!document.querySelector("button, a[href], input, canvas, img, svg, iframe, video")).catch(() => true);
  for (const until = Date.now() + EMPTY_FOR_MS; Date.now() < until; await session.page.waitForTimeout(500)) if (await drawn()) return undefined;
  if (await drawn()) return undefined;
  return { reason: EMPTY_PAGE, url: session.page.url() };
}

export function plain(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
}
