import { describe, expect, it } from "vitest";
import { SigningReview, TestResult, type Outcome, type Verdict } from "@dappdrill/core";
import { TestsFile } from "../src/files.js";
import { renderJunit } from "../src/junit.js";
import { renderMarkdown } from "../src/markdown.js";
import { exitCode, reviewsLine, summaryText } from "../src/outcomes.js";

const review = (verdict: Verdict, title = "Unlimited USDC approval") =>
  SigningReview.parse({ id: "s", requestId: "r", chainId: 1, method: "eth_sendTransaction", verdict, title, summary: "It spends USDC.", decoded: { kind: "transaction" }, explanation: "", fingerprint: "f", createdAt: "2026-11-05T00:00:00Z" });

const result = (testId: string, outcome: Outcome, verdicts: Verdict[] = [], reason?: string): TestResult =>
  TestResult.parse({ testId, outcome, reason, steps: [], signingReviews: verdicts.map((v) => review(v)), durationMs: 3000, costUsd: 0 });

const test = (id: string, name: string) => ({ id, name, goal: "g", steps: [{ type: "action", by: "llm", do: "Do it" }] });
const file = TestsFile.parse({ url: "https://app.example", tests: [test("a", "Open a long"), test("b", "Close a long"), test("c", "Withdraw")] });
const all = ["a", "b", "c"];

describe("exitCode", () => {
  it.each<[string, TestResult[], number, number]>([
    ["all passed", [result("a", "passed")], 1, 0],
    ["Check this and Looks consistent don't fail a run", [result("a", "passed", ["check", "consistent"])], 1, 0],
    ["a test failed", [result("a", "failed")], 1, 1],
    ["a Dangerous signature on a test that passed", [result("a", "passed", ["dangerous"])], 1, 1],
    ["a Dangerous signature on a test that couldn't be verified", [result("a", "unverified", ["dangerous"])], 1, 1],
    ["Failed beats Couldn't verify", [result("a", "unverified"), result("b", "failed")], 2, 1],
    ["only Couldn't verify", [result("a", "passed"), result("b", "unverified")], 2, 2],
    ["a stopped run", [result("a", "passed")], 3, 2],
    ["Failed beats a stopped run", [result("a", "failed")], 3, 1],
    ["nothing ran", [], 0, 2],
  ])("%s", (_, results, asked, code) => {
    expect(exitCode(results, asked)).toBe(code);
  });
});

describe("summaryText", () => {
  it("counts Couldn't verify apart from Failed and flags signatures beside the counts", () => {
    expect(summaryText([result("a", "passed", ["dangerous", "check"]), result("b", "failed"), result("c", "unverified")], 3)).toBe("1 of 3 passed, 1 failed, 1 couldn't be verified · 1 dangerous signature · 1 signature to check");
  });

  it("counts the tests an interrupted run never reached", () => {
    expect(summaryText([result("a", "passed")], 3)).toBe("1 of 3 passed, 2 not run");
  });
});

describe("reviewsLine", () => {
  it("counts what needs a look and never says safe", () => {
    expect(reviewsLine([])).toBeUndefined();
    expect(reviewsLine([review("consistent", "Deposit")])).toBe("1 signing request reviewed, all look consistent.");
    expect(reviewsLine([review("dangerous", "A"), review("check", "B"), review("consistent", "C")])).toBe("3 signing requests reviewed: 1 dangerous, 1 to check.");
  });
});

describe("renderJunit", () => {
  it("writes one suite for the app, a case per test that ran, and escapes the reason", () => {
    const xml = renderJunit(file, [result("a", "passed"), result("b", "failed", [], 'Line 1, "Click Withdraw": <disabled>')]);
    expect(xml).toContain('<testsuite name="app.example" tests="2" failures="1" errors="0"');
    expect(xml).toContain('classname="app.example" name="Open a long" time="3"');
    expect(xml).toContain('<failure message="Line 1, &quot;Click Withdraw&quot;: &lt;disabled&gt;"/>');
    expect(xml).not.toContain("Withdraw\" time");
  });

  it("reports a Dangerous signature on a passing test as a failure", () => {
    const xml = renderJunit(file, [result("a", "passed", ["dangerous"])]);
    expect(xml).toContain('<testsuite name="app.example" tests="1" failures="1" errors="0"');
    expect(xml).toContain('<failure message="Dangerous signature: Unlimited USDC approval"/>');
    expect(xml).toContain("<system-out>Dangerous: Unlimited USDC approval. It spends USDC.</system-out>");
  });

  it("keeps the reason when a test that failed or couldn't be verified also had one", () => {
    expect(renderJunit(file, [result("a", "failed", ["dangerous"], "Stuck.")])).toContain('<failure message="Stuck. Dangerous signature: Unlimited USDC approval"/>');
    const xml = renderJunit(file, [result("a", "unverified", ["dangerous"], "No RPC.")]);
    expect(xml).toContain('<failure message="No RPC. Dangerous signature: Unlimited USDC approval"/>');
    expect(xml).toContain('errors="0"');
  });

  it("leaves Couldn't verify as an error and Check this as a pass", () => {
    expect(renderJunit(file, [result("a", "unverified", [], "No RPC.")])).toContain('<error message="No RPC."/>');
    expect(renderJunit(file, [result("a", "passed", ["check"])])).toContain('<testsuite name="app.example" tests="1" failures="0" errors="0" skipped="0"');
  });
});

describe("renderMarkdown", () => {
  it("says all passed only when nothing needs a look", () => {
    expect(renderMarkdown(file, [result("a", "passed", ["consistent"])], ["a"])).toContain("**The test passed** on https://app.example");
    expect(renderMarkdown(file, all.map((id) => result(id, "passed")), all)).toContain("**All 3 tests passed**");
  });

  it("never reads as all passed with a Dangerous signature", () => {
    const md = renderMarkdown(file, [result("a", "passed", ["dangerous"])], ["a"]);
    expect(md).not.toContain("test passed**");
    expect(md).toContain("**1 of 1 passed · 1 dangerous signature** on https://app.example");
    expect(md).toContain("- **Open a long**: Dangerous signature: Unlimited USDC approval");
  });

  it("never reads as all passed after an interrupted run, or an empty one", () => {
    const md = renderMarkdown(file, [result("a", "passed")], ["a", "b"]);
    expect(md).toContain("**1 of 2 passed, 1 not run**");
    expect(md).toContain("- Close a long: Not run.");
    expect(renderMarkdown(file, [], all)).toContain("**No tests ran** on https://app.example");
  });

  it("says Couldn't verify rather than failed", () => {
    const md = renderMarkdown(file, [result("a", "passed"), result("b", "unverified", [], "No RPC.")], ["a", "b"]);
    expect(md).toContain("**1 of 2 passed, 1 couldn't be verified**");
    expect(md).toContain("- **Close a long**: Couldn't verify. No RPC.");
  });

  it("lists signing requests to check once, and counts them all", () => {
    const signingReviews = [review("check", "Sign in"), review("dangerous", "Approve USDC"), review("consistent", "Deposit"), review("check", "Sign in")];
    const md = renderMarkdown(file, [{ ...result("a", "passed"), signingReviews }], ["a"]);
    expect(md).toContain("3 signing requests reviewed: 1 dangerous, 1 to check.");
    expect(md).toContain("Dangerous signature: Approve USDC");
    expect(md.match(/Check this: Sign in/g)).toHaveLength(1);
    expect(md).not.toContain("Deposit.");
  });
});
