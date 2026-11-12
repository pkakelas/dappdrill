/**
 * Making a test: a goal goes in, a proven test comes out. A model does the goal once and writes the
 * test as sentences (draft.ts); the test is then run and put right until it goes the same way twice
 * in a row (prove.ts).
 */
import path from "node:path";
import type { DrillEventSink, LineResult, Test } from "@dappdrill/core";
import { refuseOnLiveMainnet } from "../chain/controller.js";
import { openSuite, type RunSuiteInput } from "../run/suite.js";
import { draftTest } from "./draft.js";
import { prove, type Proved } from "./prove.js";
import { repair } from "./repair.js";

export interface MakeInput extends RunSuiteInput {
  goal: string;
  /** Where to begin looking. The test may start elsewhere. */
  startPath?: string;
}

export interface Made extends Omit<Proved, "test"> {
  /** The test as it stands at the end, when one was written. `why` says why there is none. */
  test?: Test;
  setup?: LineResult[];
  draftUsd: number;
  costUsd: number;
  durationMs: number;
}

export async function makeTest(input: MakeInput, sink: DrillEventSink = () => {}, say: (text: string) => void = () => {}): Promise<Made> {
  const t0 = Date.now();
  const { suite, artifactsDir } = input;
  // Nothing made here may sign on a live mainnet, whoever does the line.
  const open = await openSuite(input, sink, { refuseApprove: (r) => refuseOnLiveMainnet(open.env.chains, r) });
  const { env } = open;
  let draftUsd = 0;
  const done = (more: Partial<Proved>): Made => ({ proven: false, notes: [], findings: [], repairs: [], runs: [], ...more, setup: open.setup, draftUsd, costUsd: env.costUsd(), durationMs: Date.now() - t0 });
  try {
    if (open.stuck) return done({ why: open.stuck });
    const notes = open.opts.notes!;

    say(`Drafting: ${input.goal}`);
    const draft = await draftTest(env, {
      goal: input.goal,
      startPath: input.startPath ?? "/",
      storageState: open.opts.storageState,
      notes,
      existing: suite.tests.map((t) => t.name),
      artifactsDir: path.join(artifactsDir, "draft"),
      signal: input.signal,
    });
    draftUsd = env.costUsd();
    if ("gaveUp" in draft) return done({ why: draft.gaveUp });
    notes.push(...draft.notes);
    const taken = new Set(suite.tests.map((t) => t.id));
    let test = draft.test;
    for (let n = 2; taken.has(test.id); n++) test = { ...draft.test, id: `${draft.test.id}-${n}` };
    say(`Drafted “${test.name}”: ${test.steps.length} lines, $${draftUsd.toFixed(2)}`);

    const proved = await prove({
      test,
      problems: draft.problems,
      notes,
      run: (t) => open.run(t),
      repair: (asked) => repair(env.fastLlm(), { ...asked, artifactsDir }),
      say,
    });
    return done({ ...proved, notes: [...draft.notes, ...proved.notes] });
  } finally {
    await open.close();
  }
}
