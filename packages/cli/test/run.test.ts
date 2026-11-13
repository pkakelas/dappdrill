import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestResult, type Suite } from "@dappdrill/core";
import { runTests } from "../src/commands/run.js";
import { TestsFile, UsageError } from "../src/files.js";

const verdict = vi.hoisted(() => ({ current: "dangerous" }));
const click = { kind: "click", target: { role: "button", name: "Deposit" } };

vi.mock("@dappdrill/engine/fake", () => ({
  loadEngine: async () => ({
    runSuite: async ({ suite }: { suite: Suite }, _sink: unknown, progress: { onTest?: (r: TestResult) => void }) => {
      const tests = suite.tests.map((t) =>
        TestResult.parse({
          testId: t.id,
          outcome: "passed",
          // Nothing was recorded for the line, so a model worked it out, and says which browser actions did it.
          steps: t.steps.map(() => ({ status: "pass", by: "llm", note: "", recorded: [click], durationMs: 10, costUsd: 0 })),
          signingReviews: [{ id: "s", requestId: "r", chainId: 1, method: "eth_sendTransaction", verdict: verdict.current, title: "Approve USDC", summary: "It spends USDC.", decoded: { kind: "transaction" }, explanation: "", fingerprint: "f", createdAt: "2026-11-05T00:00:00Z" }],
          durationMs: 10,
          costUsd: 0,
        }),
      );
      tests.forEach((r) => progress.onTest?.(r));
      return { tests, durationMs: 20, costUsd: 0 };
    },
  }),
}));

const tests = () =>
  TestsFile.parse({
    url: "https://app.example",
    tests: [
      { id: "test_1", name: "Deposit", goal: "Deposit.", steps: [{ type: "action", by: "code", do: "Click Deposit", run: [] }] },
      { id: "test_2", name: "Withdraw", goal: "Withdraw.", steps: [{ type: "action", by: "llm", do: "Click Withdraw" }] },
    ],
  });

const run = async (file = tests(), more: object = {}) => {
  const out = await mkdtemp(join(tmpdir(), "dappdrill-"));
  const flags = { out, chain: [], token: [], initScript: [], header: [], storage: [], respond: [], ...more };
  const code = await runTests(file, { url: "https://app.example" } as never, flags);
  return { code, file, summary: await readFile(join(out, "summary.md"), "utf8"), results: JSON.parse(await readFile(join(out, "results.json"), "utf8")) as TestResult[] };
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

  it("keeps the actions a model worked out, so the next run replays them", async () => {
    const { file } = await run();
    expect(file.tests[0]?.steps[0]).toMatchObject({ type: "action", by: "code", do: "Click Deposit", run: [click] });
  });
});
