/**
 * Making an app's tests, as the app page draws it: the look over the app, then a line for every
 * goal handed to the maker and what came of it.
 */
import { z } from "zod";
import { Fund } from "./run.js";
import { LineStatus, Suite, type Action, type LineResult } from "./suite.js";

/** What a suite holds besides its tests: the setup, the notes, and what may be signed. Kept with the app. */
export const SuiteSettings = Suite.omit({ tests: true });
export type SuiteSettings = z.infer<typeof SuiteSettings>;

/** What a new app's suite starts with: a user whose wallet is connected. Not code yet: making the first test records it. */
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

/** What was tried for a goal that got no test: the test as it last stood, and how each line went in its runs. */
export const Tried = z.object({
  name: z.string().optional(),
  lines: z
    .array(
      z.object({
        type: z.enum(["action", "check"]),
        text: z.string(),
        /** How the line went in each run of the test as it stands, oldest first. */
        runs: z.array(LineStatus).default([]),
        /** What the latest run found at the line, when it didn't pass. */
        note: z.string().optional(),
      }),
    )
    .default([]),
  /** Every run, including those of earlier wordings. */
  runs: z.number().int().default(0),
  /** The one question for the owner whose answer would let the test be made. */
  ask: z.string().optional(),
});
export type Tried = z.infer<typeof Tried>;

/** How many of the latest things done are kept, for whoever watches. */
export const DONE_KEPT = 8;

/** Something done or said while tests are made, and when. */
export const Done = z.object({ text: z.string(), at: z.string() });
export type Done = z.infer<typeof Done>;

/** Adds what was just done to a log, which keeps the latest few. */
export function noteDone(log: Done[], text: string, at = new Date().toISOString()): void {
  log.push({ text, at });
  if (log.length > DONE_KEPT) log.splice(0, log.length - DONE_KEPT);
}

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
  /** The latest things done and said while it is made, oldest first. Emptied when it ends. */
  log: z.array(Done).optional(),
  /** The latest picture of its browser, relative to the make's artifacts. */
  frame: z.string().optional(),
  /** The test it became. */
  testId: z.string().optional(),
  /** How the kept test stands: it passes, or it fails every time on a fault of the app. */
  stands: z.enum(["passed", "failed"]).optional(),
  /** Why no test was kept. */
  whyNot: z.string().optional(),
  /** What was tried, when no test was kept. */
  tried: Tried.optional(),
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
  /**
   * What would put it right, when that is known. "funds": the test account holds too little to pay, which is
   * the owner's to do. "repair": a run with no model stopped on a line that has no code, or whose recording no
   * longer fits the page.
   */
  fix: z.enum(["funds", "repair"]).optional(),
});
export type SetupStuck = z.infer<typeof SetupStuck>;

export const MakeState = z.object({
  stage: z.enum(["looking", "making", "done"]).default("looking"),
  /** What the app is, in the look's words. */
  summary: z.string().optional(),
  /** The latest thing said during the look. */
  said: z.string().optional(),
  /** The latest things done and said during the look, or a repair, oldest first. */
  log: z.array(Done).optional(),
  /** The latest picture of the look's browser. */
  frame: z.string().optional(),
  goals: z.array(MakeGoal).default([]),
  /** Why making ended early: the look came back with no goals, or no more goals were started (the spending limit, or goal after goal that couldn't be made). */
  why: z.string().optional(),
  /** The setup didn't finish, so making stopped there: the goals still waiting were never tried. */
  stuck: SetupStuck.optional(),
  /** With one goal asked for by the owner: what its test's new account starts with, when they said. */
  fund: z.array(Fund).optional(),
  /** With one goal asked for by the owner, whose making broke on our side: the owner tried it again or dismissed it, so it no longer waits for them. */
  dismissed: z.boolean().optional(),
});
export type MakeState = z.infer<typeof MakeState>;

/**
 * The setup, or the reset, with what a making or repairing run recorded written in: every action a model
 * did becomes a code action with the browser actions it took, to be replayed from now on.
 */
export function setupWithRecordings(setup: NonNullable<SuiteSettings["setup"]>, lines: LineResult[]): NonNullable<SuiteSettings["setup"]> {
  const steps = setup.steps.map((line: Action, i): Action => {
    const went = lines[i];
    return went?.status === "pass" && went.recorded?.length ? { type: "action", by: "code", do: line.do, run: went.recorded } : line;
  });
  return { ...setup, steps };
}
