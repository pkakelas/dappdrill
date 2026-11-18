/**
 * A test for each goal, so many at a time, and what each make adds to the suite. No browser and no
 * model in here: the make itself is handed in.
 */
import { withNotes, type SetupStuck, type Suite } from "@dappdrill/core";
import type { RunSuiteInput } from "../run/suite.js";
import type { Finding } from "./draft.js";
import { MAX_GOALS, type Looked } from "./look.js";
import type { Made, MakeInput } from "./maker.js";

/** How many things that looked wrong get a test of their own. */
export const MAX_SUSPICIONS = 3;
/** Goals tried in a row without a test, with none kept yet, after which no more are started: the next would most likely meet the same. */
export const MAX_UNMADE = 3;
/** How many tests are made at once on new accounts. Each has its own wallet and its own browser. */
export const TOGETHER = 3;
/** What making tests may spend unless told otherwise (DAPPDRILL_MAKE_MAX_USD sets it). */
export const MAX_USD = 30;

export interface MakeTestsInput extends RunSuiteInput {
  /** How many of the look's goals get a test. */
  count?: number;
  /** How many tests are made at once. On a kept account it is always one: the account is shared. */
  together?: number;
  /** The most the look and the makes may spend together, in dollars. No new work starts once it is reached. */
  maxUsd?: number;
}

/** What a make spends in all: the look and every test made, the ones still going included. */
export interface Spending {
  add(usd: number): void;
  /** Counts `cost` as it grows; the function returned stops following it and keeps what it came to. */
  follow(cost: () => number): () => void;
  spent(): number;
  /** Why no more should be started, once the limit is reached. */
  over(): string | undefined;
}

export function spending(maxUsd = Number(process.env.DAPPDRILL_MAKE_MAX_USD) || MAX_USD): Spending {
  let settled = 0;
  const going = new Set<() => number>();
  const spent = () => settled + [...going].reduce((sum, cost) => sum + cost(), 0);
  return {
    add: (usd) => void (settled += usd),
    follow(cost) {
      going.add(cost);
      return () => {
        if (going.delete(cost)) settled += cost();
      };
    },
    spent,
    over: () => (spent() >= maxUsd ? `Stopped at the $${maxUsd} spending limit.` : undefined),
  };
}

/** One goal handed to the maker and what came of it. */
export interface Attempt {
  goal: string;
  /** What looked wrong, when the goal is to find out whether it is. */
  suspicion?: Finding;
  made?: Made;
  /** The test went into the suite. */
  kept: boolean;
  /** Why it didn't. */
  why?: string;
  /** With no test: the one question for the owner whose answer would most likely let it be made. */
  ask?: string;
}

/** Of the things that stopped earlier goals or that kept tests fail on, the one that would stop this goal too, by its index. */
export type StoppedBy = (goal: string, stoppers: string[]) => Promise<number | undefined>;

export interface MadeTests {
  /** The suite with the new notes and tests. */
  suite: Suite;
  looked: Looked;
  attempts: Attempt[];
  /** The setup didn't finish, so making stopped there: the goals after it were never tried. */
  stuck?: SetupStuck;
  /** Why no more goals were started (the spending limit, or goal after goal that couldn't be made): the ones left were never tried. */
  stopped?: string;
  costUsd: number;
  durationMs: number;
}

export interface MakeTestsProgress {
  /** What is being done now. `n` is the make saying it; the look has none. */
  say?(text: string, n?: number): void;
  /** Waited for before any goal is started. */
  onLooked?(looked: Looked): void | Promise<void>;
  /** Before a goal goes to the maker. The look's goals come first, then what looked wrong. */
  onGoal?(goal: string, n: number, suspicion?: Finding): void;
  onAttempt?(attempt: Attempt, n: number): void | Promise<void>;
  /** The suite changed: the look's notes, or a test more. */
  onSuite?(suite: Suite): void | Promise<void>;
}

type Asked = Pick<MakeInput, "suite" | "goal" | "startPath" | "suspicion">;

/**
 * A test for each of the look's first goals, then one for each thing that looked wrong on the way.
 * Made side by side, a make doesn't have what the ones beside it learn: their notes and their tests
 * reach the makes that start after they end.
 *
 * Every make begins with the setup. When one can't finish it, the next would stop at the same
 * place, so no goal is started after that. And when a goal ends on something in its way that isn't
 * the app's fault (a market that doesn't fill), the goals that would meet it too aren't tried: they
 * say what stops them and ask what the goal that met it asked. The same for a fault of the app that a
 * kept test fails on every time: a goal that can't get past it would only fail on it again.
 *
 * When the first goals tried all end without a test, the rest would most likely too: after
 * MAX_UNMADE in a row no more are started, and what those goals ask is the way on. The goals still
 * being made are waited for before that is decided: one of them kept means the app can be tested.
 */
export async function makeEach(
  looked: Pick<Looked, "goals" | "notes" | "problems">,
  input: Pick<MakeTestsInput, "suite" | "count" | "together" | "signal"> & { overBudget?: () => string | undefined; stoppedBy?: StoppedBy },
  make: (asked: Asked, n: number) => Promise<Made>,
  progress: MakeTestsProgress = {},
): Promise<{ suite: Suite; attempts: Attempt[]; stuck?: SetupStuck; stopped?: string }> {
  let suite = input.suite;
  let stuck: SetupStuck | undefined;
  let stopped: string | undefined;
  const attempts: Attempt[] = [];
  /** Goals tried in a row that ended without a test, while none has been kept. A goal not tried doesn't count. */
  let unmade = 0;
  let keptAny = false;
  if (!looked.goals.length) return { suite, attempts };
  suite = { ...suite, notes: [...suite.notes, ...looked.notes.map((text) => ({ text, from: "look" as const }))] };
  await progress.onSuite?.(suite);

  /** What looked wrong and has no test yet, with the page it was seen from. */
  const suspected = looked.problems.map((finding) => ({ finding, startPath: "/" }));
  /**
   * What stops goals: what earlier goals ended on outside the app's fault, with the question each left
   * for the owner, and the faults kept tests fail on every time.
   */
  const stoppers: { text: string; why: string; ask?: string }[] = [];
  const stops = async (goal: string) => {
    if (!stoppers.length || !input.stoppedBy) return undefined;
    // When it can't be told, the goal is tried: that costs a make, not a test.
    const i = await input.stoppedBy(goal, stoppers.map((b) => b.text)).catch(() => undefined);
    return i === undefined ? undefined : stoppers[i];
  };

  const attempt = async (goal: string, startPath: string, suspicion?: Finding) => {
    const n = attempts.length + 1;
    progress.onGoal?.(goal, n, suspicion);
    const tried: Attempt = { goal, suspicion, kept: false };
    let ran = false;
    attempts.push(tried);
    try {
      const by = await stops(goal);
      if (by) {
        Object.assign(tried, { why: by.why, ask: by.ask });
        return await progress.onAttempt?.(tried, n);
      }
      ran = true;
      const made = (tried.made = await make({ suite, goal, startPath, suspicion }, n));
      stuck ??= made.stuck;
      tried.ask = made.ask;
      if (made.blocker) stoppers.push({ text: `In the way: ${made.blocker}`, why: `Not tried: ${made.blocker}`, ask: made.ask });
      // What it saw and didn't fail on is looked into later, by a test of its own. What a look into something saw is that same thing.
      if (!suspicion) for (const finding of made.findings) if (!finding.proven) suspected.push({ finding, startPath: made.test?.startPath ?? startPath });
      if (!made.proven || !made.test) tried.why = made.why;
      else if (suspicion && made.stands === "passed") tried.why = made.dismissed.at(-1) ?? "The app did it right when it was tried again, so there is nothing to keep.";
      else {
        tried.kept = keptAny = true;
        // Two made side by side may have come to the same id.
        const taken = new Set(suite.tests.map((t) => t.id));
        let test = made.test;
        for (let i = 2; taken.has(test.id); i++) test = { ...made.test, id: `${made.test.id}-${i}` };
        suite = { ...suite, tests: [...suite.tests, test] };
        for (const f of made.stands === "failed" ? made.findings.filter((f) => f.proven) : [])
          stoppers.push({
            text: `A fault of the app, which the test “${test.name}” fails on every time: ${f.what}. ${f.saw}`,
            why: `Not tried: it would fail on “${f.what}”, which the test “${test.name}” already fails on.`,
          });
      }
      // What a goal that wasn't kept learned is often what the next one needs most, so it is kept too, as less sure.
      // What was in the way is one of them: the goals after it may meet it too.
      const learned = made.blocker ? [...made.notes, made.blocker] : made.notes;
      if (learned.length) {
        suite = { ...suite, notes: withNotes(suite.notes, learned, tried.kept ? "maker" : "unkept") };
        await progress.onSuite?.(suite);
      } else if (tried.kept) await progress.onSuite?.(suite);
    } catch (e) {
      if (input.signal?.aborted) throw e;
      tried.why = `It broke on our side: ${e instanceof Error ? e.message : String(e)}`;
    }
    // Counted as it ends, so goals made side by side don't stop the ones beside them before they are done.
    if (ran && !tried.kept) unmade++;
    await progress.onAttempt?.(tried, n);
  };

  const together = Math.max(1, input.together ?? 1);
  /** Goals being made now. */
  const going = new Set<Promise<void>>();
  const track = (job: Promise<void>) => {
    const done = job.catch(() => undefined).finally(() => going.delete(done));
    going.add(done);
    return job;
  };
  const tooMany = () => !keptAny && unmade >= MAX_UNMADE;
  const go = async () => {
    // A goal still being made may yet be kept, and that turns the cut-off off: it is waited for first.
    while (tooMany() && going.size && !stuck) await Promise.race(going);
    return !stuck && !(stopped ??= input.overBudget?.() ?? (tooMany() ? `Stopped because the first goals tried couldn't be made: the rest would most likely meet the same. Each says why, and what would let it be made.` : undefined));
  };
  await pooled(looked.goals.slice(0, input.count ?? MAX_GOALS), together, go, (g) => track(attempt(g.goal, g.startPath)));

  const into: { goal: string; startPath: string; finding: Finding }[] = [];
  const asked = new Set<string>();
  for (const { finding, startPath } of suspected) {
    const goal = finding.goal ?? `Find out whether this is so: ${finding.what}. A user should get: ${finding.expected}`;
    // The same thing comes back in other words, and then its goal is often the same sentence.
    if (into.length >= MAX_SUSPICIONS || asked.has(finding.what.toLowerCase()) || [...attempts, ...into].some((a) => a.goal === goal)) continue;
    asked.add(finding.what.toLowerCase());
    into.push({ goal, startPath, finding });
  }
  await pooled(into, together, go, (s) => track(attempt(s.goal, s.startPath, s.finding)));
  return { suite, attempts, stuck, stopped };
}

/**
 * Does the job for every item, in order, so many at a time, for as long as `go` says to start another.
 * When one throws (stopped), the others are waited for before it is passed on, so none is left
 * holding a browser, or spending, after the caller has moved on.
 */
async function pooled<T>(items: T[], together: number, go: () => Promise<boolean>, job: (item: T) => Promise<void>): Promise<void> {
  const waiting = [...items];
  const worker = async () => {
    // Another worker may have taken the last one while `go` waited.
    while (waiting.length && (await go()) && waiting.length) await job(waiting.shift()!);
  };
  const ended = await Promise.allSettled(Array.from({ length: Math.min(together, waiting.length) }, worker));
  const threw = ended.find((e) => e.status === "rejected");
  if (threw) throw threw.reason;
}
