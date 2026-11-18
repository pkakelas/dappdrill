import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Suite, Test } from "@dappdrill/core";
import { repairCommand } from "../src/commands/repair.js";
import { TestsFile, UsageError } from "../src/files.js";

const click = (name: string) => ({ kind: "click", target: { role: "button", name } });
const asked = vi.hoisted(() => ({ testIds: undefined as string[] | undefined, edit: undefined as (() => Promise<void>) | undefined }));

vi.mock("@dappdrill/engine/fake", () => ({
  loadEngine: async () => ({
    // Every line that isn't code is written as code, except in a test named "Borrow", which can't be repaired.
    repairSuite: async ({ suite, testIds }: { suite: Suite; testIds?: string[] }, _sink: unknown, progress: { onStart?: (id: string) => void; onTest?: (done: { testId: string; test?: Test; why?: string }) => Promise<void> | void }) => {
      asked.testIds = testIds;
      await asked.edit?.();
      const tests = [];
      for (const t of suite.tests.filter((t) => (testIds ? testIds.includes(t.id) : t.steps.some((line) => line.by === "llm")))) {
        progress.onStart?.(t.id);
        const done = t.name === "Borrow" ? { testId: t.id, why: "The borrow button never appeared." } : { testId: t.id, test: { ...t, steps: t.steps.map((line) => (line.type === "action" ? { type: "action" as const, by: "code" as const, do: line.do, run: [click(line.do)] } : line)) } as Test };
        await progress.onTest?.(done);
        tests.push(done);
      }
      const setup = suite.setup && { ...suite.setup, steps: suite.setup.steps.map((line) => ({ type: "action" as const, by: "code" as const, do: line.do, run: [click("Connect")] })) };
      return { setup, tests, costUsd: 0.2, durationMs: 10 };
    },
  }),
}));

const test = (id: string, name: string, by: "code" | "llm" = "llm") => ({ id, name, goal: `${name}.`, steps: [by === "llm" ? { type: "action", by, do: `Click ${name}` } : { type: "action", by, do: `Click ${name}`, run: [click(name)] }] });

async function saved(tests: object[]): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "dappdrill-")), "tests.json");
  await writeFile(path, JSON.stringify({ url: "https://app.example", setup: { startPath: "/", steps: [{ type: "action", by: "llm", do: "Connect the wallet" }] }, tests }));
  return path;
}

const repair = async (path: string, more: object = {}) => {
  const out = await mkdtemp(join(tmpdir(), "dappdrill-"));
  const code = await repairCommand(path, { out, chain: [], fund: [], initScript: [], header: [], storage: [], respond: [], ...more });
  return { code, file: TestsFile.parse(JSON.parse(await readFile(path, "utf8"))) };
};

beforeEach(() => {
  asked.testIds = undefined;
  asked.edit = undefined;
  vi.stubEnv("DAPPDRILL_KEY", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("repairCommand", () => {
  it("writes the repaired setup and tests into the file, and leaves the rest as it was", async () => {
    const path = await saved([test("test_1", "Deposit", "code"), test("test_2", "Withdraw")]);
    const { code, file } = await repair(path);
    expect(code).toBe(0);
    expect(asked.testIds).toBeUndefined();
    expect(file.setup?.steps[0]).toMatchObject({ by: "code", run: [click("Connect")] });
    expect(file.tests.map((t) => t.steps[0]?.by)).toEqual(["code", "code"]);
    expect(file.tests[1]?.steps[0]).toMatchObject({ do: "Click Withdraw", run: [click("Click Withdraw")] });
    expect(file.tests[0]).toMatchObject(test("test_1", "Deposit", "code"));
  });

  it("repairs only the tests --only names", async () => {
    const path = await saved([test("test_1", "Deposit"), test("test_2", "Withdraw")]);
    const { file } = await repair(path, { only: "with" });
    expect(asked.testIds).toEqual(["test_2"]);
    expect(file.tests.map((t) => t.steps[0]?.by)).toEqual(["llm", "code"]);
    await expect(repair(path, { only: "swap" })).rejects.toThrow(UsageError);
  });

  it("exits 2 when a test couldn't be repaired, keeping the ones that were", async () => {
    const path = await saved([test("test_1", "Borrow"), test("test_2", "Withdraw")]);
    const { code, file } = await repair(path);
    expect(code).toBe(2);
    expect(file.tests.map((t) => t.steps[0]?.by)).toEqual(["llm", "code"]);
  });

  it("keeps an edit made to the file while its test was being repaired", async () => {
    const path = await saved([test("test_1", "Deposit"), test("test_2", "Withdraw")]);
    asked.edit = async () => {
      const now = JSON.parse(await readFile(path, "utf8"));
      now.tests[0].steps[0].do = "Click Deposit twice";
      await writeFile(path, JSON.stringify(now));
    };
    const { code, file } = await repair(path);
    expect(code).toBe(2);
    expect(file.tests[0]?.steps[0]).toMatchObject({ by: "llm", do: "Click Deposit twice" });
    expect(file.tests[1]?.steps[0]?.by).toBe("code");
  });
});
