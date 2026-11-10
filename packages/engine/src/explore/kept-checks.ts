/**
 * The checks an explorer made on a path, placed on the test the path became. A check is kept on the
 * step it followed, and only when it passes again on the proof: the explorer's path is its guess,
 * the clean fork is the judge.
 */
import { testCheckKey, type ExploreSuggestion, type Step, type TestStep, type TestStepResult } from "@dappdrill/core";

type PathCheck = NonNullable<ExploreSuggestion["checks"]>[number];

/**
 * Where a check made after `after` of the recorded actions goes: on the step that holds the action
 * just before it (or the nearest earlier one with a step, since a detour belongs to none), when the
 * steps are the recording lined up with the test (`lined`). A check made at the end of the path goes
 * on the last step whatever the steps hold. The rest can't be placed and stay checks of the pass.
 */
export function placeChecks(steps: TestStep[], checks: PathCheck[], recorded: Step[], lined: boolean): TestStep[] {
  if (steps.length === 0 || checks.length === 0) return steps;
  const owner = (after: number): number | undefined => {
    if (after >= recorded.length) return steps.length - 1;
    if (!lined) return undefined;
    for (let k = after - 1; k >= 0; k--) {
      const at = steps.findIndex((s) => s.actions?.includes(recorded[k]!));
      if (at >= 0) return at;
    }
    return undefined;
  };
  const out = steps.map((s) => ({ ...s }));
  for (const c of checks) {
    const at = owner(c.after);
    if (at === undefined) continue;
    const step = out[at]!;
    const mine = step.checks ?? [];
    if (mine.some((x) => testCheckKey(x) === testCheckKey(c))) continue;
    step.checks = [...mine, { name: c.name, assert: c.assert }];
  }
  return out;
}

/** The steps with only the checks that passed on this run, by their place. */
export function passingChecks(steps: TestStep[], results: TestStepResult[]): TestStep[] {
  return steps.map((s, i) => {
    const kept = s.checks?.filter((_, j) => results[i]?.checks?.[j]?.status === "pass");
    const { checks: _checks, ...rest } = s;
    return kept?.length ? { ...rest, checks: kept } : rest;
  });
}
