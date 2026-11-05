import { VERDICT_LABEL, type SigningReview } from "@dappdrill/core";
import type { TestOutcome } from "@dappdrill/engine";

export interface Tally {
  passed: number;
  failed: number;
  couldntRun: number;
  /** Stopped before it ran, or never reached: the run is incomplete. */
  stopped: number;
  /** The engine found the test doesn't apply here, e.g. it needs a fork. */
  skipped: number;
}

/** `total` is how many tests were asked for: a stopped run has no outcome for the ones it never reached. */
export function tally(outcomes: TestOutcome[], total = outcomes.length): Tally {
  const count = (s: TestOutcome["status"]) => outcomes.filter((o) => o.status === s).length;
  return { passed: count("pass"), failed: count("fail"), couldntRun: count("error"), stopped: count("stopped") + total - outcomes.length, skipped: count("skipped") };
}

/**
 * 0 all passed, 1 a test failed or a Dangerous review counts as failing, 2 we couldn't tell:
 * something couldn't run, the run stopped, or nothing ran.
 */
export function exitCode(t: Tally, dangerous = false): number {
  if (t.failed || dangerous) return 1;
  return t.couldntRun || t.stopped || !t.passed ? 2 : 0;
}

export function tallyLine(t: Tally): string {
  const notRun = t.stopped + t.skipped;
  return [`${t.passed} passed`, t.failed && `${t.failed} failed`, t.couldntRun && `${t.couldntRun} couldn't run`, notRun && `${notRun} not run`].filter(Boolean).join(", ");
}

export const DANGEROUS_FAILS = "This run fails because a signing request is Dangerous.";

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
  const count = (v: SigningReview["verdict"]) => reviews.filter((r) => r.verdict === v).length;
  const flagged = [count("dangerous") && `${count("dangerous")} dangerous`, count("check") && `${count("check")} to check`].filter(Boolean).join(", ");
  const head = `${reviews.length} signing ${reviews.length === 1 ? "request" : "requests"} reviewed`;
  return flagged ? `${head}: ${flagged}.` : `${head}, all look consistent.`;
}
