import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestRunResult } from "@dappdrill/core";
import { runTests } from "../src/commands/run.js";
import type { TestsFile } from "../src/files.js";

const verdict = vi.hoisted(() => ({ current: "dangerous" }));

vi.mock("@dappdrill/engine/fake", () => ({
  loadEngine: async () => ({
    runTests: async (_target: unknown, items: { spec: { id: string } }[]) => ({
      outcomes: items.map((i) => ({
        testId: i.spec.id,
        status: "pass",
        result: { ...TestRunResult.parse({}), signingReviews: [{ verdict: verdict.current, title: "Approve USDC", summary: "It spends USDC." }] },
      })),
    }),
  }),
}));

describe("--fail-on-dangerous", () => {
  const tests = (): TestsFile => ({
    url: "https://app.example",
    chains: [],
    flows: [{ name: "Deposit", tests: [{ id: "test_1", name: "Deposit", goal: "Deposit.", expected: "Done.", startPath: "/", steps: [{ text: "Click Deposit" }] }] }],
  });
  const run = async (failOnDangerous: boolean) => {
    const out = await mkdtemp(join(tmpdir(), "dappdrill-"));
    const flags = { out, condition: [], chain: [], token: [], initScript: [], header: [], storage: [], respond: [], failOnDangerous };
    const code = await runTests(tests(), { url: "https://app.example" } as never, flags);
    return { code, summary: await readFile(join(out, "summary.md"), "utf8") };
  };

  beforeEach(() => {
    verdict.current = "dangerous";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("fails a passing run on a Dangerous review and says why", async () => {
    const { code, summary } = await run(true);
    expect(code).toBe(1);
    expect(summary).toContain("This run fails because a signing request is Dangerous.");
  });

  it("leaves the exit code alone without the flag, or for a lesser verdict", async () => {
    expect((await run(false)).code).toBe(0);
    verdict.current = "check";
    expect((await run(true)).code).toBe(0);
  });
});
