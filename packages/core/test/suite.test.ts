import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CodeAssert, fillValues, LineResult, outcomeOf, Suite, Test, TestResult, withRecordings } from "../src/suite.js";

const line = (status: LineResult["status"]) => LineResult.parse({ status, by: "code" });

describe("outcomeOf", () => {
  it("is Passed only when every line passed", () => {
    expect(outcomeOf([line("pass"), line("pass")])).toBe("passed");
  });

  it("is Failed when any line failed, whatever the others say", () => {
    expect(outcomeOf([line("pass"), line("unsure"), line("fail"), line("skipped")])).toBe("failed");
  });

  it("is Couldn't verify when nothing failed but a line is unsure or wasn't reached", () => {
    expect(outcomeOf([line("pass"), line("unsure")])).toBe("unverified");
    expect(outcomeOf([line("pass"), line("skipped")])).toBe("unverified");
  });
});

describe("Test", () => {
  const base = { id: "t", name: "T", goal: "G" };

  it("takes actions and checks done by code or by a model", () => {
    const test = Test.parse({
      ...base,
      steps: [
        { type: "action", by: "code", do: "Click Deposit.", run: [{ kind: "click", target: { role: "button", name: "Deposit" } }] },
        { type: "action", by: "llm", do: "Pick the first market in the list." },
        { type: "check", by: "code", claim: "It was mined.", expect: { kind: "mined" } },
        { type: "check", by: "llm", claim: "The page says the deposit went through." },
      ],
    });
    expect(test.startPath).toBe("/");
    expect(test.steps.map((s) => `${s.type} ${s.by}`)).toEqual(["action code", "action llm", "check code", "check llm"]);
  });

  it("takes a code action that isn't recorded yet, and refuses a code check with nothing to expect", () => {
    expect(Test.parse({ ...base, steps: [{ type: "action", by: "code", do: "Click." }] }).steps[0]).toMatchObject({ run: [] });
    expect(Test.safeParse({ ...base, steps: [{ type: "check", by: "code", claim: "It worked." }] }).success).toBe(false);
  });
});

describe("fillValues", () => {
  const written = Test.parse({
    id: "w",
    name: "Withdraw",
    goal: "Take {{amount}} out.",
    values: { amount: { from: 20, to: 21 }, price: { from: 100, to: 200, decimals: 1 } },
    steps: [
      { type: "action", by: "code", do: "Enter {{amount}}.", run: [{ kind: "fill", target: { role: "textbox", name: "Amount" }, value: "{{amount}}" }] },
      { type: "check", by: "code", claim: "Cash fell by {{amount}}.", expect: { kind: "changes", figure: "Cash", by: "-{{amount}}" } },
      { type: "check", by: "llm", claim: "An order at {{price}} is listed, and {{other}} is left alone." },
    ],
    cleanup: [{ type: "action", by: "llm", do: "Cancel the order at {{price}}." }],
  });

  it("writes one pick of each value everywhere it is named", () => {
    const { test, values } = fillValues(written, () => 0.5);
    expect(values).toEqual({ amount: "20.50", price: "150.0" });
    expect(JSON.stringify(test.steps[0])).toContain('"value":"20.50"');
    expect(test.steps[1]).toMatchObject({ claim: "Cash fell by 20.50.", expect: { by: "-20.50" } });
    expect(test.steps[2]).toMatchObject({ claim: "An order at 150.0 is listed, and {{other}} is left alone." });
    expect(test.cleanup[0]).toMatchObject({ do: "Cancel the order at 150.0." });
  });

  it("leaves a test with no values as it was", () => {
    const plain = Test.parse({ id: "t", name: "T", goal: "G", steps: [{ type: "check", by: "code", claim: "Mined.", expect: { kind: "mined" } }] });
    expect(fillValues(plain)).toEqual({ test: plain, values: {} });
  });
});

describe("withRecordings", () => {
  const test = Test.parse({
    id: "o",
    name: "Order",
    goal: "Place an order.",
    values: { size: { from: 0.01, to: 0.05 }, price: { from: 100, to: 200 } },
    steps: [
      { type: "action", by: "code", do: "Enter {{size}} as the size and {{price}} as the price." },
      { type: "action", by: "code", do: "Click Place order.", run: [{ kind: "click", target: { role: "button", name: "Old" } }] },
      { type: "action", by: "llm", do: "Cancel whatever is open." },
      { type: "check", by: "llm", claim: "The order is listed." },
    ],
  });
  const fill = (name: string, value: string) => ({ kind: "fill" as const, target: { role: "textbox", name }, value });
  const click = (name: string) => ({ kind: "click" as const, target: { role: "button", name } });
  const result = (steps: Partial<LineResult>[]) =>
    TestResult.parse({ testId: "o", outcome: "passed", values: { size: "0.03", price: "150.03" }, steps: steps.map((s) => ({ status: "pass", by: "llm", ...s })), durationMs: 0, costUsd: 0 });

  it("writes in what a model did for a code action, with the run's values under their names", () => {
    const made = withRecordings(test, result([{ recorded: [fill("Size", "0.03"), fill("Price", "150.03")] }, { recorded: [click("Place 0.03")] }, { recorded: [click("Cancel")] }, {}]));
    expect(made.steps[0]).toMatchObject({ run: [{ value: "{{size}}" }, { value: "{{price}}" }] });
    expect(made.steps[1]).toMatchObject({ run: [{ target: { name: "Place {{size}}" } }] });
    expect(made.steps[2]).toEqual(test.steps[2]);
  });

  it("leaves a line alone when the action didn't pass or code did it", () => {
    const made = withRecordings(test, result([{ status: "unsure", recorded: [fill("Size", "0.03")] }, { by: "code" }, {}, {}]));
    expect(made).toEqual(test);
  });

  it("doesn't keep a recording that lost a value the sentence names", () => {
    const made = withRecordings(test, result([{ recorded: [fill("Size", "0.03"), fill("Price", "150")] }, {}, {}, {}]));
    expect(made.steps[0]).toEqual(test.steps[0]);
  });
});

describe("the suites written by hand", () => {
  it.each(["harbor-vault", "pod"])("%s parses, with every value it names declared", (name) => {
    const file = new URL(`../../../fixtures/${name}/tests.json`, import.meta.url);
    const suite = Suite.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(suite.setup?.steps.length).toBeGreaterThan(0);
    expect(new Set(suite.tests.map((t) => t.id)).size).toBe(suite.tests.length);
    for (const test of suite.tests) expect(JSON.stringify(fillValues(test).test), test.id).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe("CodeAssert", () => {
  it("takes a page's path for where a figure is read, and not a label", () => {
    expect(CodeAssert.safeParse({ kind: "changes", figure: "Cash", by: 20, on: "/home" }).success).toBe(true);
    expect(CodeAssert.safeParse({ kind: "changes", figure: "Your position", by: 20, on: "Your position" }).success).toBe(false);
  });
});
