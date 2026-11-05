import { describe, expect, it } from "vitest";
import { SigningReview, TestRunResult, type TestRunStatus, type Verdict } from "@dappdrill/core";
import type { TestOutcome } from "@dappdrill/engine";
import { testLabels, type SavedTest, type TestsFile } from "../src/files.js";
import { renderJunit } from "../src/junit.js";
import { renderMarkdown } from "../src/markdown.js";
import { exitCode, summaryText } from "../src/outcomes.js";

const review = (verdict: Verdict, title = "Unlimited USDC approval") =>
  SigningReview.parse({ id: "s", requestId: "r", chainId: 1, method: "eth_sendTransaction", verdict, title, summary: "", decoded: { kind: "transaction" }, explanation: "", fingerprint: "f", createdAt: "2026-11-05T00:00:00Z" });

const outcome = (testId: string, status: TestRunStatus, verdicts: Verdict[] = [], failure?: string): TestOutcome => ({
  testId,
  status,
  result: TestRunResult.parse({ failure, signingReviews: verdicts.map((v) => review(v)) }),
});

const test = (id: string, name: string, extra: Partial<SavedTest> = {}): SavedTest => ({ id, name, goal: "g", expected: "e", startPath: "/", steps: [], ...extra });
const file: TestsFile = {
  url: "https://app.example",
  chains: [],
  flows: [{ name: "Trade", tests: [test("a", "Open a long"), test("b", "Slow RPC", { baseId: "a", condition: "slow-rpc" }), test("c", "Close a long")] }],
};

describe("exitCode", () => {
  it.each<[string, TestOutcome[], number]>([
    ["all passed", [outcome("a", "pass")], 0],
    ["a condition that doesn't apply is no problem", [outcome("a", "pass"), outcome("b", "skipped")], 0],
    ["Check this and Looks consistent don't fail a run", [outcome("a", "pass", ["check", "consistent"])], 0],
    ["a test failed", [outcome("a", "fail")], 1],
    ["a Dangerous signature on a test that passed", [outcome("a", "pass", ["dangerous"])], 1],
    ["a Dangerous signature on a test that couldn't run", [outcome("a", "error", ["dangerous"])], 1],
    ["a Dangerous signature on a stopped test", [outcome("a", "stopped", ["dangerous"])], 1],
    ["Failed beats Couldn't run", [outcome("a", "error"), outcome("b", "fail")], 1],
    ["Dangerous beats Couldn't run", [outcome("a", "error"), outcome("b", "pass", ["dangerous"])], 1],
    ["only Couldn't run", [outcome("a", "pass"), outcome("b", "error")], 2],
  ])("%s", (_, outcomes, code) => {
    expect(exitCode(outcomes)).toBe(code);
  });
});

describe("summaryText", () => {
  it("counts Couldn't run apart from Failed and flags signatures beside the counts", () => {
    expect(summaryText([outcome("a", "pass", ["dangerous", "check"]), outcome("b", "fail"), outcome("c", "error")])).toBe("1 of 3 passed, 1 failed, 1 couldn't run · 1 dangerous signature · 1 signature to check");
  });
});

describe("testLabels", () => {
  it("names a condition after its test", () => {
    expect(testLabels(file).get("a")).toBe("Trade · Open a long");
    expect(testLabels(file).get("b")).toBe("Trade · Open a long · Slow RPC");
  });

  it("finds a base in another flow", () => {
    const flows = [{ name: "Trade", tests: [test("a", "Open a long")] }, { name: "Edge", tests: [test("b", "Slow RPC", { baseId: "a" })] }];
    expect(testLabels({ ...file, flows }).get("b")).toBe("Edge · Open a long · Slow RPC");
  });
});

describe("renderJunit", () => {
  it('names cases "Flow · Test · Condition"', () => {
    const xml = renderJunit(file, [outcome("a", "pass"), outcome("b", "pass")]);
    expect(xml).toContain('classname="Trade" name="Trade · Open a long" time');
    expect(xml).toContain('classname="Trade" name="Trade · Open a long · Slow RPC" time');
  });

  it("reports a Dangerous signature on a passing test as a failure", () => {
    const xml = renderJunit(file, [outcome("a", "pass", ["dangerous"])]);
    expect(xml).toContain('<testsuite name="Trade" tests="1" failures="1" errors="0"');
    expect(xml).toContain('<failure message="Dangerous signature: Unlimited USDC approval"/>');
  });

  it("keeps the reason when a test that failed or couldn't run also had one", () => {
    expect(renderJunit(file, [outcome("a", "fail", ["dangerous"], "Stuck.")])).toContain('<failure message="Stuck. Dangerous signature: Unlimited USDC approval"/>');
    const xml = renderJunit(file, [outcome("a", "error", ["dangerous"], "No RPC.")]);
    expect(xml).toContain('<failure message="No RPC. Dangerous signature: Unlimited USDC approval"/>');
    expect(xml).toContain('errors="0"');
  });

  it("leaves Couldn't run as an error and Check this as a pass", () => {
    expect(renderJunit(file, [outcome("a", "error", [], "No RPC.")])).toContain('<error message="No RPC."/>');
    expect(renderJunit(file, [outcome("a", "pass", ["check"])])).toContain('failures="0" errors="0" skipped="0" time="0">\n    <testcase classname="Trade" name="Trade · Open a long" time="0"></testcase>');
  });
});

describe("renderMarkdown", () => {
  it("says all passed only when nothing needs a look", () => {
    expect(renderMarkdown(file, [outcome("a", "pass", ["consistent"])])).toContain("**All 1 tests passed**");
  });

  it("never reads as all passed with a Dangerous signature", () => {
    const md = renderMarkdown(file, [outcome("a", "pass", ["dangerous"])]);
    expect(md).not.toContain("All 1 tests passed");
    expect(md).toContain("**1 of 1 passed · 1 dangerous signature** on https://app.example");
    expect(md).toContain("- **Trade · Open a long**: Dangerous signature: Unlimited USDC approval");
  });

  it("says Couldn't run rather than failed", () => {
    const md = renderMarkdown(file, [outcome("a", "pass"), outcome("b", "error", [], "No RPC.")]);
    expect(md).toContain("**1 of 2 passed, 1 couldn't run**");
    expect(md).toContain("- **Trade · Open a long · Slow RPC**: Couldn't run. No RPC.");
  });
});
