/**
 * A test for each goal, so many at a time, and what each make adds to the suite. No browser and no
 * model in here: the make itself is handed in.
 */
import type { SetupStuck, Suite } from "@dappdrill/core";
import type { RunSuiteInput } from "../run/suite.js";
import type { Finding } from "./draft.js";
import type { Looked } from "./look.js";
import type { Made, MakeInput } from "./maker.js";

/** How many things that looked wrong get a test of their own. */
export const MAX_SUSPICIONS = 3;
/** How many tests are made at once when every chain is a local copy. Each has its own copies and its own browser. */
export const TOGETHER = 3;

export interface MakeTestsInput extends RunSuiteInput {
  /** How many of the look's goals get a test. */
  count?: number;
  /** How many tests are made at once. On a live chain it is always one: the account is shared. */
  together?: number;
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
}

export interface MadeTests {
  /** The suite with the new notes and tests. */
  suite: Suite;
  looked: Looked;
  attempts: Attempt[];
  /** The setup didn't finish, so making stopped there: the goals after it were never tried. */
  stuck?: SetupStuck;
  costUsd: number;
  durationMs: number;
}

export interface MakeTestsProgress {
  /** What is being done now. `n` is the make saying it; the look has none. */
  say?(text: string, n?: number): void;
  onLooked?(looked: Looked): void;
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
 * place, so no goal is started after that.
 */
export async function makeEach(looked: Pick<Looked, "goals" | "notes" | "problems">, input: Pick<MakeTestsInput, "suite" | "count" | "together" | "signal">, make: (asked: Asked, n: number) => Promise<Made>, progress: MakeTestsProgress = {}): Promise<{ suite: Suite; attempts: Attempt[]; stuck?: SetupStuck }> {
  let suite = input.suite;
  let stuck: SetupStuck | undefined;
  const attempts: Attempt[] = [];
  if (!looked.goals.length) return { suite, attempts };
  suite = { ...suite, notes: [...suite.notes, ...looked.notes.map((text) => ({ text, from: "look" as const }))] };
  await progress.onSuite?.(suite);

  /** What looked wrong and has no test yet, with the page it was seen from. */
  const suspected = looked.problems.map((finding) => ({ finding, startPath: "/" }));

  const attempt = async (goal: string, startPath: string, suspicion?: Finding) => {
    const n = attempts.length + 1;
    progress.onGoal?.(goal, n, suspicion);
    const tried: Attempt = { goal, suspicion, kept: false };
    attempts.push(tried);
    try {
      const made = (tried.made = await make({ suite, goal, startPath, suspicion }, n));
      stuck ??= made.stuck;
      // What it saw and didn't fail on is looked into later, by a test of its own. What a look into something saw is that same thing.
      if (!suspicion) for (const finding of made.findings) if (!finding.proven) suspected.push({ finding, startPath: made.test?.startPath ?? startPath });
      if (!made.proven || !made.test) tried.why = made.why;
      else if (suspicion && made.stands === "passed") tried.why = made.dismissed.at(-1) ?? "The app did it right when it was tried again, so there is nothing to keep.";
      else {
        tried.kept = true;
        const known = new Set(suite.notes.map((note) => note.text));
        // Two made side by side may have come to the same id.
        const taken = new Set(suite.tests.map((t) => t.id));
        let test = made.test;
        for (let i = 2; taken.has(test.id); i++) test = { ...made.test, id: `${made.test.id}-${i}` };
        suite = { ...suite, notes: [...suite.notes, ...made.notes.filter((note) => !known.has(note)).map((text) => ({ text, from: "maker" as const }))], tests: [...suite.tests, test] };
        await progress.onSuite?.(suite);
      }
    } catch (e) {
      if (input.signal?.aborted) throw e;
      tried.why = `It broke on our side: ${e instanceof Error ? e.message : String(e)}`;
    }
    await progress.onAttempt?.(tried, n);
  };

  const together = Math.max(1, input.together ?? 1);
  const go = () => !stuck;
  await pooled(looked.goals.slice(0, input.count ?? 10), together, go, (g) => attempt(g.goal, g.startPath));

  const into: { goal: string; startPath: string; finding: Finding }[] = [];
  const asked = new Set<string>();
  for (const { finding, startPath } of suspected) {
    const goal = finding.goal ?? `Find out whether this is so: ${finding.what}. A user should get: ${finding.expected}`;
    // The same thing comes back in other words, and then its goal is often the same sentence.
    if (into.length >= MAX_SUSPICIONS || asked.has(finding.what.toLowerCase()) || [...attempts, ...into].some((a) => a.goal === goal)) continue;
    asked.add(finding.what.toLowerCase());
    into.push({ goal, startPath, finding });
  }
  await pooled(into, together, go, (s) => attempt(s.goal, s.startPath, s.finding));
  return { suite, attempts, stuck };
}

/** Does the job for every item, in order, so many at a time, for as long as `go` says to start another. */
async function pooled<T>(items: T[], together: number, go: () => boolean, job: (item: T) => Promise<void>): Promise<void> {
  const waiting = [...items];
  const worker = async () => {
    while (waiting.length && go()) await job(waiting.shift()!);
  };
  await Promise.all(Array.from({ length: Math.min(together, waiting.length) }, worker));
}
