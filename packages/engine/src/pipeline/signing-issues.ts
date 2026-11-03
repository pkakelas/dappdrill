/**
 * Signing reviews become issues when they found something: Dangerous is
 * critical, a failing check is medium, a warning (unlimited approval, a
 * revert, a changed spender) is low. Reviews that only lack data we couldn't
 * confirm stay reviews. One issue per distinct request per flow, however many
 * edge cases repeated it.
 */
import { describeStep, fingerprint, newId, nowIso, type Flow, type FlowRun, type Issue, type Severity, type SigningReview } from "@dappdrill/core";

export function signingIssues(flow: Flow, reviews: SigningReview[], runs: FlowRun[]): Issue[] {
  const runById = new Map(runs.map((r) => [r.id, r]));
  const isHappy = (r: SigningReview) => runById.get(r.runId ?? "")?.edgeCase === "happy";

  // Prefer the happy-path review: its evidence shows the flow as a user would do it.
  const byRequest = new Map<string, SigningReview>();
  for (const review of reviews) {
    const current = byRequest.get(review.fingerprint);
    if (!current || (isHappy(review) && !isHappy(current))) byRequest.set(review.fingerprint, review);
  }

  const issues: Issue[] = [];
  for (const review of byRequest.values()) {
    const severity = severityOf(review);
    if (!severity) continue;
    const run = runById.get(review.runId ?? "");
    const reason = firstReason(review);
    issues.push({
      id: newId("iss"),
      fingerprint: fingerprint(flow.id, "signing", review.fingerprint),
      severity,
      category: "signing",
      title: reason ? `${reason}: ${review.title}` : review.title,
      summary: review.summary,
      flowId: flow.id,
      flowName: flow.name,
      edgeCase: run?.edgeCase,
      runId: review.runId,
      stepIndex: review.stepIndex,
      stepsToReproduce: flow.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`),
      expected: review.ui.buttonLabel ? `A request that does what “${review.ui.buttonLabel}” says` : undefined,
      actual: review.explanation,
      evidence: {
        screenshot: review.ui.screenshot,
        video: run?.video,
        trace: run?.trace,
        signingReviewId: review.id,
        buttonLabel: review.ui.buttonLabel,
        walletAsked: review.title,
      },
      unverified: review.checks.some((c) => c.status === "unverified" && (c.id === "verified-source" || c.id === "contract-age")) || undefined,
      createdAt: nowIso(),
    });
  }
  return issues;
}

function severityOf(review: SigningReview): Severity | undefined {
  if (review.verdict === "dangerous") return "critical";
  if (review.checks.some((c) => c.status === "fail")) return "medium";
  if (review.checks.some((c) => c.status === "warn")) return "low";
  return undefined;
}

/** "Don't ship this. Unlimited where the UI shows 100. …" → "Unlimited where the UI shows 100" */
function firstReason(review: SigningReview): string | undefined {
  const sentences = review.explanation.split(/(?<=\.)\s+/);
  return sentences[1]?.replace(/\.$/, "");
}
