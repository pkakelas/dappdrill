/** Opening a browser session in an engine call's environment. */
import { newId, type Blocked, type DrillEvent } from "@dappdrill/core";
import { detectBotCheck } from "../browser/access.js";
import { createSession, type EngineSession, type SessionOptions } from "../runtime.js";
import type { Env } from "./env.js";

export const debug = (m: string) => {
  if (process.env.DAPPDRILL_DEBUG) console.error(`[engine] ${m}`);
};

/** A session whose live frames go to `onFrame`. */
export function openSession(env: Env, artifactsDir: string, onFrame: ((path: string) => Promise<void>) | undefined, extra: Partial<SessionOptions> = {}): Promise<EngineSession> {
  return createSession(env.target, env.chains, {
    artifactsDir,
    headless: env.headless,
    runId: newId("run"),
    log: debug,
    sink: async (e: DrillEvent) => {
      if (e.type === "frame") await onFrame?.(e.path);
      else if (e.type === "log" && e.level !== "info") await env.sink(e);
    },
    ...extra,
  });
}

/** Challenges often load a moment after the page; look twice before calling the page clean. */
export async function landingBotCheck(session: EngineSession): Promise<Blocked | undefined> {
  const first = await detectBotCheck(session.page);
  if (first) return first;
  await session.page.waitForTimeout(2_500);
  return detectBotCheck(session.page);
}

export function plain(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
}
