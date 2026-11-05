/**
 * The cheap way to keep checks fresh: repeat each one from its recorded actions and look again,
 * with no model. Anything that signs stays with the saved tests.
 */
import { nowIso, type AppSetup, type CheckReplay, type DrillEventSink, type DrillTarget, type SweepResults } from "@dappdrill/core";
import { openEnv } from "../pipeline/env.js";
import { pin } from "../pipeline/flows.js";
import { setupRunner } from "../pipeline/setup.js";
import { flowOf, openSession, plain } from "../pipeline/steps.js";
import { replayFlow } from "../runtime.js";
import { evaluateCheck } from "./checks.js";
import { sweepable } from "./replays.js";

export async function sweepChecks(
  target: DrillTarget,
  replays: CheckReplay[],
  opts: { artifactsDir: string; setup?: AppSetup; headless?: boolean },
  sink: DrillEventSink = () => {},
  signal?: AbortSignal,
): Promise<{ sweep: SweepResults; costUsd: number }> {
  const env = await openEnv(target, sink, { headless: opts.headless });
  const runner = opts.setup?.steps.length ? setupRunner(env, opts.setup, { artifactsDir: opts.artifactsDir }, {}) : undefined;
  const results: SweepResults["results"] = {};
  try {
    for (const r of replays.filter(sweepable)) {
      if (signal?.aborted) break;
      const ready = await runner?.prepare({ id: r.id, name: r.name, goal: "", expected: "", startPath: r.startPath, steps: [] }, signal);
      if (ready && "outcome" in ready) {
        results[r.id] = { status: "error", evidence: ready.outcome.result.failure ?? "The app's setup didn't finish." };
        continue;
      }
      const restore = await pin(env);
      const session = await openSession(env, opts.artifactsDir, undefined, { storageState: ready?.pre.storageState, video: false, trace: false, frameIntervalMs: 0 });
      try {
        await session.page.goto(new URL(r.startPath, env.target.url).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
        const replay = await replayFlow(session, flowOf({ id: r.id, name: r.name, startPath: r.startPath }, r.actions), { here: true, reviewer: env.reviewer, inbox: env.inbox, signal });
        results[r.id] = replay.completed ? await evaluateCheck(session, r.assert) : { status: "error", evidence: replay.error ?? "The recorded actions no longer work." };
      } catch (e) {
        results[r.id] = { status: "error", evidence: plain(e) };
      } finally {
        await session.close().catch(() => {});
        await restore();
      }
    }
    return { sweep: { at: nowIso(), results }, costUsd: env.costUsd() };
  } finally {
    await runner?.close();
    await env.close();
  }
}
