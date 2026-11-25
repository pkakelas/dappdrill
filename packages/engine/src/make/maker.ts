/**
 * Making a test: a goal goes in, a proven test comes out. A model does the goal once and writes the
 * test, each check with its code (draft.ts); the test is then run, its actions recorded, and put right
 * until it goes the same way twice in a row with no model (prove.ts). A test that fails every time is
 * only kept when a second look agrees the app is at fault (doubt.ts).
 */
import path from "node:path";
import type { DrillEventSink, Fund, LineResult, SetupStuck, Test } from "@dappdrill/core";
import { openSuite, type RunSuiteInput } from "../run/suite.js";
import { askOwner, type AskInput } from "./ask.js";
import { findCause } from "./cause.js";
import { doubt, ours } from "./doubt.js";
import { draftTest, type Finding } from "./draft.js";
import { spending, type Spending } from "./each.js";
import { prove, type Proved } from "./prove.js";
import { repair, writeCheck } from "./repair.js";

export interface MakeInput extends RunSuiteInput {
  goal: string;
  /** Where to begin looking. The test may start elsewhere. */
  startPath?: string;
  /** What the test's new account starts with, when that isn't what the app sends every new account. The test keeps it. */
  fund?: Fund[];
  /** What looked wrong earlier, when the goal is to find out whether it is. */
  suspicion?: Finding;
  /** The most this make may spend, in dollars: no run of it starts after that. */
  maxUsd?: number;
  /** What the makes of one makeTests spend together, in place of `maxUsd`, so its limit counts them all. */
  spending?: Spending;
}

export interface Made extends Omit<Proved, "test"> {
  /** The test as it stands at the end, when one was written. `why` says why there is none. */
  test?: Test;
  /** With no test: the one question for the owner whose answer would most likely let it be made. */
  ask?: string;
  setup?: LineResult[];
  /** The setup didn't finish, so the goal was never tried. The next goal would end the same way. */
  stuck?: SetupStuck;
  draftUsd: number;
  costUsd: number;
  durationMs: number;
}

export async function makeTest(input: MakeInput, sink: DrillEventSink = () => {}, say: (text: string) => void = () => {}): Promise<Made> {
  const t0 = Date.now();
  const { suite, artifactsDir } = input;
  const spent = input.spending ?? spending(input.maxUsd);
  // Making is where a model does what has no code yet: the setup's lines too.
  const open = await openSuite(input, sink, { byModel: true, fund: input.fund });
  const { env } = open;
  const settle = spent.follow(() => env.costUsd());
  let draftUsd = 0;
  const done = (more: Partial<Proved> & Pick<Made, "stuck">): Made => ({
    proven: false,
    notes: [],
    findings: [],
    repairs: [],
    dismissed: [],
    runs: [],
    ...more,
    setup: open.setup,
    draftUsd,
    costUsd: env.costUsd(),
    durationMs: Date.now() - t0,
  });
  /** Why there is no test, from what was seen, and the question it leaves. The maker's own reason stands if this fails. */
  const asked = async (tried: Omit<AskInput, "goal" | "notes" | "ours" | "artifactsDir" | "why"> & { why?: string }): Promise<{ why?: string; ask?: string }> => {
    const why = tried.why ?? "It didn't go the same way twice.";
    if (input.signal?.aborted || spent.over()) return { why };
    try {
      return await askOwner(env.fastLlm(), { ...tried, why, goal: input.goal, notes: open.opts.notes ?? [], ours: ours(env, input.fund), artifactsDir, signal: input.signal });
    } catch {
      return { why };
    }
  };
  try {
    if (open.stuck) return done({ why: open.stuck, stuck: open.stuckAt ?? { reason: open.stuck } });
    const notes = open.opts.notes!;
    const set = ours(env, input.fund);

    say(`Drafting: ${input.goal}`);
    const start = await open.fresh(undefined, input.fund);
    if (start.why) return done({ why: start.why, stuck: start.stuck ?? { reason: start.why } });
    const draft = await draftTest(start, {
      goal: input.goal,
      startPath: input.startPath ?? "/",
      notes,
      existing: suite.tests.map((t) => t.name),
      suspicion: input.suspicion,
      ours: set,
      artifactsDir: path.join(artifactsDir, "draft"),
      signal: input.signal,
    });
    // The draft's account is done with: what it holds pays for the runs that prove the test.
    open.finished(start);
    draftUsd = env.costUsd();
    // What it learned on the way, and what stopped it, may be what the next goal needs most.
    if ("gaveUp" in draft) return done({ notes: draft.notes, blocker: draft.blocker, ...(await asked({ why: draft.gaveUp, runs: [], repairs: [], dismissed: [], findings: [] })) });
    notes.push(...draft.notes);
    const taken = new Set(suite.tests.map((t) => t.id));
    const drafted: Test = input.fund ? { ...draft.test, fund: input.fund } : draft.test;
    let test = drafted;
    for (let n = 2; taken.has(test.id); n++) test = { ...drafted, id: `${drafted.id}-${n}` };
    say(`Drafted “${test.name}”: ${test.steps.length} lines, $${draftUsd.toFixed(2)}`);

    const proved = await prove({
      test,
      problems: draft.problems,
      notes,
      run: (t, more) => open.run(t, more),
      asCode: (asked) => writeCheck(env.fastLlm(), { ...asked, artifactsDir, signal: input.signal }),
      shared: env.target.account === "kept",
      repair: (asked) => repair(env.fastLlm(), { ...asked, ours: set, artifactsDir, signal: input.signal }),
      lookInto: async (asked) => {
        const from = await open.fresh(undefined, input.fund);
        try {
          return from.why ? undefined : await findCause(from, { ...asked, notes, artifactsDir: path.join(artifactsDir, "cause"), signal: input.signal });
        } finally {
          open.finished(from);
        }
      },
      // The thinking model: it is asked once or twice a test, and only for a test about to be kept as failing.
      doubt: (asked) => doubt(env.thinkLlm(), { ...asked, ours: set, artifactsDir, signal: input.signal }),
      overBudget: spent.over,
      say,
    });
    const all = { ...proved, notes: [...draft.notes, ...proved.notes] };
    return done(proved.proven ? all : { ...all, ...(await asked({ ...proved, runs: proved.runs.slice(proved.runs.length - (proved.worded ?? 0)) })) });
  } finally {
    settle();
    await open.close();
    // What was spent reaches the caller even when the make was stopped or broke and nothing is returned.
    await Promise.resolve(sink({ type: "cost", usd: env.costUsd() })).catch(() => {});
  }
}
