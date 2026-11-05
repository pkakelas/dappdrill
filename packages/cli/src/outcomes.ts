import { applicable, count, countsText, readOf, signingOf, signingText, type SigningReview } from "@dappdrill/core";
import type { TestOutcome } from "@dappdrill/engine";

export function dangerous(o: TestOutcome): SigningReview[] {
  return o.result.signingReviews.filter((r) => r.verdict === "dangerous");
}

/** 1 for Failed or a Dangerous signature, even on a test that passed; 2 when the only problem is Couldn't run. */
export function exitCode(outcomes: TestOutcome[]): 0 | 1 | 2 {
  if (outcomes.some((o) => o.status === "fail" || dangerous(o).length > 0)) return 1;
  return outcomes.some((o) => o.status === "error") ? 2 : 0;
}

/** "4 of 6 passed, 1 failed, 1 couldn't run · 1 dangerous signature" */
export function summaryText(outcomes: TestOutcome[]): string {
  const counts = countsText(count(applicable(outcomes.map((o) => readOf(o, o)))));
  const signing = signingText(signingOf(outcomes.flatMap((o) => o.result.signingReviews.map((r) => r.verdict))));
  return signing ? `${counts} · ${signing}` : counts;
}
