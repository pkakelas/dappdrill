import { VERDICT_LABEL, type SigningReview, type TestResult } from "@dappdrill/core";

/** Under a test that stopped on a line that isn't code, or whose code stopped working. A run uses no model, so it can't go on. */
export const NEEDS_REPAIR = "Needs repairing: run dappdrill repair.";

/** Why a test didn't pass, with what to do about it when it needs repairing. */
export function whyNot(r: TestResult): string {
  return [r.reason, r.repairable ? NEEDS_REPAIR : undefined].filter(Boolean).join(" ");
}

export function dangerous(r: TestResult): SigningReview[] {
  return r.signingReviews.filter((s) => s.verdict === "dangerous");
}

/**
 * 1 for Failed or a Dangerous signature, even on a test that passed; 2 when the only problem is a
 * test that couldn't be verified, a test an interrupted run never reached, or that nothing ran.
 * `asked` is how many tests the run was for.
 */
export function exitCode(results: TestResult[], asked: number): 0 | 1 | 2 {
  if (results.some((r) => r.outcome === "failed" || dangerous(r).length > 0)) return 1;
  return results.length < asked || results.length === 0 || results.some((r) => r.outcome === "unverified") ? 2 : 0;
}

/** "3 of 6 passed, 1 failed, 1 couldn't be verified (1 needs repairing), 1 not run · 1 dangerous signature · 2 signatures to check" */
export function summaryText(results: TestResult[], asked: number): string {
  const n = (outcome: TestResult["outcome"]) => results.filter((r) => r.outcome === outcome).length;
  const notRun = asked - results.length;
  const repair = results.filter((r) => r.repairable).length;
  const unverified = n("unverified") && `${n("unverified")} couldn't be verified${repair ? ` (${repair} ${repair === 1 ? "needs" : "need"} repairing)` : ""}`;
  const counts = [`${n("passed")} of ${asked} passed`, n("failed") && `${n("failed")} failed`, unverified, notRun > 0 && `${notRun} not run`].filter(Boolean).join(", ");
  const verdicts = results.flatMap((r) => r.signingReviews.map((s) => s.verdict));
  const having = (v: SigningReview["verdict"]) => verdicts.filter((x) => x === v).length;
  const plural = (n: number) => (n === 1 ? "signature" : "signatures");
  const signing = [having("dangerous") && `${having("dangerous")} dangerous ${plural(having("dangerous"))}`, having("check") && `${having("check")} ${plural(having("check"))} to check`].filter(Boolean);
  return [counts, ...signing].join(" · ");
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
