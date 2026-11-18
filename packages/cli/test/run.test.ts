import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestResult, type Suite } from "@dappdrill/core";
import { runTests } from "../src/commands/run.js";
import { TestsFile, UsageError } from "../src/files.js";

const verdict = vi.hoisted(() => ({ current: "dangerous" }));

vi.mock("@dappdrill/engine/fake", () => ({
  loadEngine: async () => ({
    runSuite: async ({ suite }: { suite: Suite }, _sink: unknown, progress: { onTest?: (r: TestResult) => void }) => {
      // A run has no model: a line that isn't code stops the test, which then needs repairing.
      const tests = suite.tests.map((t) => {
        const code = t.steps.every((line) => line.by === "code");
        return TestResult.parse({
          testId: t.id,
          outcome: code ? "passed" : "unverified",
          reason: code ? undefined : "Line 1 isn't code yet.",
          repairable: !code,
          steps: t.steps.map(() => ({ status: code ? "pass" : "unsure", by: "code", note: "", durationMs: 10, costUsd: 0 })),
          signingReviews: [{ id: "s", requestId: "r", chainId: 1, method: "eth_sendTransaction", verdict: verdict.current, title: "Approve USDC", summary: "It spends USDC.", decoded: { kind: "transaction" }, explanation: "", fingerprint: "f", createdAt: "2026-11-05T00:00:00Z" }],
          durationMs: 10,
          costUsd: 0,
        });
      });
      tests.forEach((r) => progress.onTest?.(r));
      return { tests, durationMs: 20, costUsd: 0 };
    },
  }),
}));

const tests = () =>
  TestsFile.parse({
    url: "https://app.example",
    tests: [
      { id: "test_1", name: "Deposit", goal: "Deposit.", steps: [{ type: "action", by: "code", do: "Click Deposit", run: [{ kind: "click", target: { role: "button", name: "Deposit" } }] }] },
      { id: "test_2", name: "Withdraw", goal: "Withdraw.", steps: [{ type: "action", by: "code", do: "Click Withdraw", run: [{ kind: "click", target: { role: "button", name: "Withdraw" } }] }] },
    ],
  });

const run = async (file = tests(), more: object = {}) => {
  const out = await mkdtemp(join(tmpdir(), "dappdrill-"));
  const flags = { out, chain: [], fund: [], initScript: [], header: [], storage: [], respond: [], ...more };
  const log = vi.mocked(console.log);
  log.mockClear();
  const code = await runTests(file, { url: "https://app.example" } as never, flags, "tests/app.json");
  return { code, file, said: log.mock.calls.map((c) => String(c[0])), summary: await readFile(join(out, "summary.md"), "utf8"), results: JSON.parse(await readFile(join(out, "results.json"), "utf8")) as TestResult[] };
};

beforeEach(() => {
  verdict.current = "consistent";
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a Dangerous signature", () => {
  it("fails a passing run and says why", async () => {
    verdict.current = "dangerous";
    const { code, summary } = await run();
    expect(code).toBe(1);
    expect(summary).toContain("Dangerous signature: Approve USDC");
  });

  it("leaves a lesser verdict alone", async () => {
    verdict.current = "check";
    expect((await run()).code).toBe(0);
  });
});

describe("runTests", () => {
  it("runs only the tests --only names", async () => {
    const { code, results, summary } = await run(tests(), { only: "with" });
    expect(code).toBe(0);
    expect(results.map((r) => r.testId)).toEqual(["test_2"]);
    expect(summary).toContain("**The test passed**");
    await expect(run(tests(), { only: "swap" })).rejects.toThrow(UsageError);
  });

  it("leaves the file as it was", async () => {
    const before = tests();
    const { file } = await run(tests());
    expect(file).toEqual(before);
  });

  it("says which tests need repairing and how, and exits 2 for them", async () => {
    const file = tests();
    file.tests[1]!.steps = [{ type: "action", by: "llm", do: "Click Withdraw" }];
    const { code, said, summary, results } = await run(file);
    expect(code).toBe(2);
    expect(results.map((r) => r.repairable)).toEqual([false, true]);
    expect(said).toContain("      Needs repairing: run dappdrill repair.");
    expect(said.at(-1)).toBe("Repair what needs it with: dappdrill repair tests/app.json");
    expect(summary).toContain("- **Withdraw**: Couldn't verify. Line 1 isn't code yet. Needs repairing: run dappdrill repair.");
  });
});
