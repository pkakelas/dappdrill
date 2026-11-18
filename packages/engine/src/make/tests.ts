/**
 * From an app to its tests: the look lists goals, the maker makes a test for each, and whatever
 * looked wrong on the way gets a test of its own. So a fault is only ever reported as a test that
 * fails on it every time: what was seen once and can't be made to fail again is let go.
 */
import path from "node:path";
import type { DrillEventSink } from "@dappdrill/core";
import { createLlm } from "../agent/index.js";
import { stoppedBy } from "./blocked.js";
import { makeEach, spending, TOGETHER, type MadeTests, type MakeTestsInput, type MakeTestsProgress } from "./each.js";
import { lookForGoals } from "./look.js";
import { makeTest } from "./maker.js";

export { makeEach, MAX_SUSPICIONS, MAX_UNMADE, TOGETHER, type Attempt, type StoppedBy, type MadeTests, type MakeTestsInput, type MakeTestsProgress } from "./each.js";

/** Cost events on the sink carry what the whole make has spent so far, the look and every test made. */
export async function makeTests(input: MakeTestsInput, sink: DrillEventSink = () => {}, progress: MakeTestsProgress = {}): Promise<MadeTests> {
  const t0 = Date.now();
  const spent = spending(input.maxUsd);
  const looked = await lookForGoals({ ...input, artifactsDir: path.join(input.artifactsDir, "look") }, sink, progress.say);
  spent.add(looked.costUsd);
  await sink({ type: "cost", usd: spent.spent() });
  await progress.onLooked?.(looked);
  // A kept account is one user: two tests made on it at once would meet each other's orders.
  const together = input.target.account === "kept" ? 1 : (input.together ?? TOGETHER);
  // Every test is made on the chains the look ended with.
  const target = { ...input.target, chains: looked.chains };
  // The fast model tells whether what stopped one goal would stop the next.
  const fast = createLlm({ role: "fast" });
  const total: DrillEventSink = (event) => sink(event.type === "cost" ? { type: "cost", usd: spent.spent() } : event);
  const made = await makeEach(
    looked,
    { ...input, together, overBudget: spent.over, stoppedBy: stoppedBy(fast) },
    (asked, n) => makeTest({ ...input, ...asked, target, spending: spent, artifactsDir: path.join(input.artifactsDir, `make-${n}`) }, total, (text) => progress.say?.(text, n)),
    progress,
  );
  spent.add(fast.costUsd());
  return { ...made, stuck: made.stuck ?? looked.stuck, looked, costUsd: spent.spent(), durationMs: Date.now() - t0 };
}
