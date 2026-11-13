/**
 * From an app to its tests: the look lists goals, the maker makes a test for each, and whatever
 * looked wrong on the way gets a test of its own. So a fault is only ever reported as a test that
 * fails on it every time: what was seen once and can't be made to fail again is let go.
 */
import path from "node:path";
import type { DrillEventSink } from "@dappdrill/core";
import { makeEach, TOGETHER, type MadeTests, type MakeTestsInput, type MakeTestsProgress } from "./each.js";
import { lookForGoals } from "./look.js";
import { makeTest } from "./maker.js";

export { makeEach, MAX_SUSPICIONS, TOGETHER, type Attempt, type MadeTests, type MakeTestsInput, type MakeTestsProgress } from "./each.js";

export async function makeTests(input: MakeTestsInput, sink: DrillEventSink = () => {}, progress: MakeTestsProgress = {}): Promise<MadeTests> {
  const t0 = Date.now();
  const looked = await lookForGoals({ ...input, artifactsDir: path.join(input.artifactsDir, "look") }, sink, progress.say);
  progress.onLooked?.(looked);
  const together = looked.live ? 1 : (input.together ?? TOGETHER);
  // Every test is made on the chains the look ended with, copied at the same blocks, and with the tokens it gave the wallet.
  const target = { ...input.target, chains: looked.chains, tokens: looked.tokens };
  const made = await makeEach(looked, { ...input, together }, (asked, n) => makeTest({ ...input, ...asked, target, artifactsDir: path.join(input.artifactsDir, `make-${n}`) }, sink, (text) => progress.say?.(text, n)), progress);
  return { ...made, stuck: made.stuck ?? looked.stuck, looked, costUsd: looked.costUsd + made.attempts.reduce((sum, a) => sum + (a.made?.costUsd ?? 0), 0), durationMs: Date.now() - t0 };
}
