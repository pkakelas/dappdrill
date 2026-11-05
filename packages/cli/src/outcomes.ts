import { TestRunResult, VERDICT_LABEL, applicable, count, countsText, readOf, signingOf, signingText, type SigningReview } from "@dappdrill/core";
import type { TestOutcome } from "@dappdrill/engine";

export function dangerous(o: TestOutcome): SigningReview[] {
  return o.result.signingReviews.filter((r) => r.verdict === "dangerous");
}

/** An interrupted run never reaches the tests after it: they count as stopped, so a partial run can't read as finished. */
export function withStopped(testIds: string[], outcomes: TestOutcome[]): TestOutcome[] {
  const ran = new Set(outcomes.map((o) => o.testId));
  return [...outcomes, ...testIds.filter((id) => !ran.has(id)).map((testId): TestOutcome => ({ testId, status: "stopped", result: TestRunResult.parse({}) }))];
}

/** 1 for Failed or a Dangerous signature, even on a test that passed; 2 when the only problem is Couldn't run, a stopped run, or that nothing ran. */
export function exitCode(outcomes: TestOutcome[]): 0 | 1 | 2 {
  if (outcomes.some((o) => o.status === "fail" || dangerous(o).length > 0)) return 1;
  return outcomes.some((o) => o.status === "error" || o.status === "stopped") || !outcomes.some((o) => o.status === "pass") ? 2 : 0;
}

/** "4 of 6 passed, 1 failed, 1 couldn't run · 1 dangerous signature" */
export function summaryText(outcomes: TestOutcome[]): string {
  const counts = countsText(count(applicable(outcomes.map((o) => readOf(o, o)))));
  const signing = signingText(signingOf(outcomes.flatMap((o) => o.result.signingReviews.map((r) => r.verdict))));
  return signing ? `${counts} · ${signing}` : counts;
}

export function reviewLine(r: SigningReview): string {
  return `${VERDICT_LABEL[r.verdict]}: ${r.title}. ${r.summary}`;
}

/** Each signing request once, however many tests repeated it; the worst verdicts first. */
export function distinctReviews<T extends { review: SigningReview }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = `${item.review.verdict} ${item.review.title}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  const rank = { dangerous: 0, check: 1, consistent: 2 };
  return [...seen.values()].sort((a, b) => rank[a.review.verdict] - rank[b.review.verdict]);
}

/** "8 signing requests reviewed: 1 dangerous, 2 to check." */
export function reviewsLine(reviews: SigningReview[]): string | undefined {
  if (reviews.length === 0) return undefined;
  const having = (v: SigningReview["verdict"]) => reviews.filter((r) => r.verdict === v).length;
  const flagged = [having("dangerous") && `${having("dangerous")} dangerous`, having("check") && `${having("check")} to check`].filter(Boolean).join(", ");
  const head = `${reviews.length} signing ${reviews.length === 1 ? "request" : "requests"} reviewed`;
  return flagged ? `${head}: ${flagged}.` : `${head}, all look consistent.`;
}
