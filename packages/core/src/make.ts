/**
 * Making an app's tests, as the app page draws it: the look over the app, then a line for every
 * goal handed to the maker and what came of it.
 */
import { z } from "zod";
import { Suite, type Action, type LineResult } from "./suite.js";

/** What a suite holds besides its tests: the setup, the notes, and what may be signed. Kept with the app. */
export const SuiteSettings = Suite.omit({ tests: true });
export type SuiteSettings = z.infer<typeof SuiteSettings>;

/** What a new app's suite starts with: a user whose wallet is connected. */
export const CONNECTED: NonNullable<SuiteSettings["setup"]> = {
  startPath: "/",
  steps: [{ type: "action", by: "llm", do: "Connect the wallet to the app (it is listed as MetaMask) and close any first-visit prompt in the way. If the app shows the wallet as connected already, do nothing." }],
};

/** A fault of the app that a test fails on every time: what a user was entitled to, and what the app did. */
export const Fault = z.object({
  /** What is wrong, like a heading. */
  what: z.string().min(1),
  expected: z.string().default(""),
  saw: z.string().default(""),
});
export type Fault = z.infer<typeof Fault>;

export const MakeGoal = z.object({
  goal: z.string().min(1),
  startPath: z.string().default("/"),
  /** What a user loses when this is broken, from the look. */
  why: z.string().optional(),
  /** What looked wrong, when the goal is to find out whether it is. */
  suspicion: z.string().optional(),
  status: z.enum(["waiting", "making", "kept", "not-kept"]).default("waiting"),
  /** The latest thing said while it is made. */
  said: z.string().optional(),
  /** The latest picture of its browser, relative to the make's artifacts. */
  frame: z.string().optional(),
  /** The test it became. */
  testId: z.string().optional(),
  /** How the kept test stands: it passes, or it fails every time on a fault of the app. */
  stands: z.enum(["passed", "failed"]).optional(),
  /** Why no test was kept. */
  whyNot: z.string().optional(),
  /** No test was kept, and the owner dismissed it or tried it again: it leaves the app's list of goals without a test. */
  dismissed: z.boolean().optional(),
  costUsd: z.number().default(0),
  durationMs: z.number().default(0),
});
export type MakeGoal = z.infer<typeof MakeGoal>;

/** Where a setup stopped, so nothing after it could be tried. */
export const SetupStuck = z.object({
  /** The setup line it stopped at, counted from 1, and that line's sentence. Neither when the app shut us out before any line. */
  line: z.number().int().positive().optional(),
  sentence: z.string().optional(),
  /** What went wrong there. */
  reason: z.string(),
  /** What the owner can put right, when it is that: test funds on a chain that can't be forked. */
  fix: z.enum(["funds"]).optional(),
});
export type SetupStuck = z.infer<typeof SetupStuck>;

export const MakeState = z.object({
  stage: z.enum(["looking", "making", "done"]).default("looking"),
  /** What the app is, in the look's words. */
  summary: z.string().optional(),
  /** The latest thing said during the look. */
  said: z.string().optional(),
  /** The latest picture of the look's browser. */
  frame: z.string().optional(),
  goals: z.array(MakeGoal).default([]),
  /** Why there are no goals, when the look came back with none. */
  why: z.string().optional(),
  /** The setup didn't finish, so making stopped there: the goals still waiting were never tried. */
  stuck: SetupStuck.optional(),
});
export type MakeState = z.infer<typeof MakeState>;

/**
 * The setup with what a run recorded written in: every code action a model did keeps the browser
 * actions it took, to be replayed from now on.
 */
export function setupWithRecordings(setup: NonNullable<SuiteSettings["setup"]>, lines: LineResult[]): NonNullable<SuiteSettings["setup"]> {
  const steps = setup.steps.map((line: Action, i): Action => {
    const went = lines[i];
    return line.by === "code" && went?.status === "pass" && went.recorded?.length ? { ...line, run: went.recorded } : line;
  });
  return { ...setup, steps };
}
