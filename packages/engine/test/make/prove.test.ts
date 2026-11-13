import { describe, expect, it } from "vitest";
import { outcomeOf, sentence, Test, TestResult, type LineResult } from "@dappdrill/core";
import { Doubt } from "../../src/make/doubt.js";
import { prove, type ProveInput } from "../../src/make/prove.js";
import { Repair } from "../../src/make/repair.js";

const drafted = Test.parse({
  id: "go",
  name: "Go",
  goal: "Go somewhere.",
  steps: [
    { type: "action", by: "code", do: "Click Go." },
    { type: "check", by: "llm", claim: "It went." },
    { type: "check", by: "llm", claim: "The total is right." },
  ],
});
const clicks = [{ kind: "click" as const, target: { role: "button", name: "Go" } }];
const STATUS = { p: "pass", f: "fail", u: "unsure", s: "skipped" } as const;
type Letters = string;

/**
 * A run that goes the way its letters say, one per line (p, f, u, s). A code action with nothing
 * recorded is done by a model and comes back recorded; `redo` makes it so for a recorded one too.
 */
function ran(test: Test, letters: Letters, more: { redo?: boolean; outcome?: TestResult["outcome"]; reason?: string } = {}): TestResult {
  const steps = test.steps.map((line, i): LineResult => {
    const status = STATUS[(letters[i] ?? "s") as keyof typeof STATUS];
    const base = { status, note: status === "pass" ? "" : `line ${i + 1} ${status}`, did: [], durationMs: 0, costUsd: 0 };
    if (line.type !== "action" || line.by !== "code") return { ...base, by: line.by };
    const byModel = !line.run.length || more.redo;
    return byModel ? { ...base, by: "llm", redone: line.run.length ? "The button wasn't there." : undefined, recorded: status === "pass" ? clicks : undefined } : { ...base, by: "code" };
  });
  const outcome = more.outcome ?? outcomeOf(steps);
  return TestResult.parse({ testId: test.id, outcome, reason: more.reason ?? (outcome === "passed" ? undefined : "It didn't pass."), steps, durationMs: 0, costUsd: 0 });
}

/** Proves `drafted` against runs and repairs given in order. Says what was asked of the repairer. */
async function proving(runs: (Letters | ((test: Test) => TestResult))[], repairs: object[] = [], problems: ProveInput["problems"] = [], doubts?: object[]) {
  const asked: Parameters<ProveInput["repair"]>[0][] = [];
  const doubted: Parameters<NonNullable<ProveInput["doubt"]>>[0][] = [];
  const notes: string[] = [];
  let r = 0;
  const proved = await prove({
    test: drafted,
    problems,
    notes,
    run: async (test) => {
      const next = runs[r++];
      if (next === undefined) throw new Error("more runs than expected");
      return typeof next === "string" ? ran(test, next) : next(test);
    },
    repair: async (input) => {
      asked.push(input);
      const fix = repairs[asked.length - 1];
      if (!fix) throw new Error("more repairs than expected");
      return Repair.parse({ why: "because", ...fix });
    },
    doubt: doubts && (async (input) => {
      doubted.push(input);
      const second = doubts[doubted.length - 1];
      if (!second) throw new Error("more second looks than expected");
      return Doubt.parse(second);
    }),
  });
  return { proved, asked, doubted, notes, runsLeft: runs.length - r };
}

const lines = (test: Test) => test.steps.map(sentence);
const fault = { what: "The total is wrong", expected: "The total of the rows.", saw: "A total of 0." };

describe("prove", () => {
  it("takes a draft that passes: one run to record it, two more to see it hold", async () => {
    const { proved, asked, runsLeft } = await proving(["ppp", "ppp", "ppp"]);
    expect(proved).toMatchObject({ proven: true, stands: "passed", repairs: [], findings: [] });
    expect(proved.test.steps[0]).toMatchObject({ by: "code", run: clicks });
    expect(proved.runs).toHaveLength(3);
    expect(asked).toHaveLength(0);
    expect(runsLeft).toBe(0);
  });

  it("puts a wrong line right and proves the test as it is worded then", async () => {
    const edit = { verdict: "test", edits: [{ line: 3, op: "replace", with: { type: "check", by: "llm", text: "The total is shown." } }] };
    const { proved, asked } = await proving(["ppf", "ppp", "ppp"], [edit]);
    expect(proved).toMatchObject({ proven: true, stands: "passed" });
    expect(lines(proved.test)).toEqual(["Click Go.", "It went.", "The total is shown."]);
    // The action was recorded by the run that failed further down, and the repair kept it.
    expect(proved.test.steps[0]).toMatchObject({ run: clicks });
    expect(asked[0]).toMatchObject({ line: 2, flips: false });
    expect(proved.repairs).toHaveLength(1);
  });

  it("keeps a test that fails every time on a fault of the app", async () => {
    const { proved } = await proving(["ppf", "ppf", "ppf"], [{ verdict: "app", finding: fault }]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
    expect(lines(proved.test)).toEqual(lines(drafted));
  });

  it("writes a fault down once when the walker had seen it already", async () => {
    const { proved } = await proving(["ppf", "ppf", "ppf"], [{ verdict: "app", known: 1, finding: { ...fault, what: "Same thing in other words" } }], [fault]);
    expect(proved.findings).toEqual([{ ...fault, proven: true }]);
  });

  it("asks again when the line left to fail passes after all, and drops it when nobody can say why", async () => {
    const { proved, asked } = await proving(["ppf", "ppf", "ppp", "ppp", "pp", "pp"], [{ verdict: "app", finding: fault }, { verdict: "cant-tell" }, { verdict: "cant-tell" }]);
    expect(asked[1]).toMatchObject({ line: 2, flips: true });
    expect(proved).toMatchObject({ proven: true, stands: "passed", findings: [{ ...fault, proven: false }] });
    expect(lines(proved.test)).toEqual(["Click Go.", "It went."]);
  });

  it("goes round a fault when the repair says how, and still reports it", async () => {
    const round = { verdict: "app", finding: fault, note: "The total only shows after a reload.", edits: [{ line: 3, op: "insert-before", with: { type: "action", by: "llm", text: "Reload the page." } }] };
    const { proved, notes } = await proving(["ppf", "pppp", "pppp"], [round]);
    expect(proved).toMatchObject({ proven: true, stands: "passed", findings: [{ ...fault, proven: false }], notes: ["The total only shows after a reload."] });
    expect(notes).toEqual(["The total only shows after a reload."]);
    expect(lines(proved.test)).toEqual(["Click Go.", "It went.", "Reload the page.", "The total is right."]);
  });

  it("takes out a check nobody can decide twice", async () => {
    const { proved } = await proving(["ppu", "ppu", "pp", "pp"], [{ verdict: "cant-tell" }, { verdict: "cant-tell" }]);
    expect(proved).toMatchObject({ proven: true, stands: "passed" });
    expect(lines(proved.test)).toEqual(["Click Go.", "It went."]);
  });

  it("gives up on an action that can't be done twice and nobody can say why", async () => {
    const { proved } = await proving(["uss", "uss"], [{ verdict: "cant-tell" }, { verdict: "cant-tell" }]);
    expect(proved.proven).toBe(false);
    expect(proved.why).toMatch(/“Click Go.” couldn't be done twice/);
  });

  it("doesn't count a run whose recording had to be made again, and hands the action to a model after three", async () => {
    const redo = (test: Test) => ran(test, "ppp", { redo: true });
    const { proved } = await proving(["ppp", redo, redo, "ppp", "ppp"]);
    expect(proved).toMatchObject({ proven: true, stands: "passed" });
    expect(proved.test.steps[0]).toEqual({ type: "action", by: "llm", do: "Click Go." });
    expect(proved.repairs).toEqual([expect.stringMatching(/is a model's from now on/)]);
    expect(proved.runs).toHaveLength(5);
  });

  it("proves a failure that is in no line: the page threw the same error twice", async () => {
    const threw = (test: Test) => ran(test, "ppp", { outcome: "failed", reason: "The page threw an error: x is undefined" });
    const { proved, asked } = await proving([threw, threw, threw]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ what: "The page threw an error: x is undefined", proven: true }] });
    expect(asked).toHaveLength(0);
  });

  it("decides every line of a run that didn't pass: one fault of the app, one of the test", async () => {
    const reword = { verdict: "test", edits: [{ line: 3, op: "replace", with: { type: "check", by: "llm", text: "The total is about right." } }] };
    const { proved, asked } = await proving(["pff", "pfp", "pfp"], [{ verdict: "app", finding: fault }, reword]);
    // Both were asked about from the first run.
    expect(asked.map((a) => [a.line, a.runs.length])).toEqual([[1, 1], [2, 1]]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
    expect(lines(proved.test)).toEqual(["Click Go.", "It went.", "The total is about right."]);
    expect(proved.runs).toHaveLength(3);
  });

  it("lets two lines stand on the same fault, and writes it down once", async () => {
    const { proved, asked } = await proving(["pff", "pff", "pff"], [{ verdict: "app", finding: fault }, { verdict: "app", known: 1 }]);
    expect(asked).toHaveLength(2);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
    expect(proved.findings).toHaveLength(1);
  });

  it("doesn't ask about the checks after an action the app wouldn't take", async () => {
    const { proved, asked } = await proving(["fff", "fff"], [{ verdict: "app", finding: fault }]);
    expect(asked.map((a) => a.line)).toEqual([0]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
  });

  it("leaves any number of lines to fail without calling it a repair", async () => {
    const stand = (n: number) => ({ verdict: "app", finding: { ...fault, what: `Fault ${n}` } });
    const six = Test.parse({ ...drafted, steps: [drafted.steps[0], ...[1, 2, 3, 4, 5, 6].map((n) => ({ type: "check", by: "llm", claim: `Claim ${n}.` }))] });
    const asked: number[] = [];
    const proved = await prove({
      test: six,
      problems: [],
      notes: [],
      run: async (test) => ran(test, "pffffff"),
      repair: async (input) => (asked.push(input.line), Repair.parse({ why: "because", ...stand(input.line) })),
    });
    expect(asked).toEqual([1, 2, 3, 4, 5, 6]);
    expect(proved).toMatchObject({ proven: true, stands: "failed" });
    expect(proved.findings.every((f) => f.proven)).toBe(true);
    expect(proved.runs).toHaveLength(3);
  });

  it("stops after four repairs", async () => {
    const reword = (n: number) => ({ verdict: "test", edits: [{ line: 3, op: "replace", with: { type: "check", by: "llm", text: `The total is right, try ${n}.` } }] });
    const { proved, asked } = await proving(["ppf", "ppf", "ppf", "ppf", "ppf"], [1, 2, 3, 4].map(reword));
    expect(asked).toHaveLength(4);
    expect(proved).toMatchObject({ proven: false, why: expect.stringMatching(/^Still not steady after 4 repairs\. “/) });
  });

  it("stops after seven runs", async () => {
    const refused = { verdict: "test", edits: [{ line: 8, op: "remove" }] };
    const { proved } = await proving(["ppp", "ppf", "ppp", "ppf", "ppp", "ppf", "ppp"], [refused, refused, refused]);
    expect(proved).toMatchObject({ proven: false, why: "Still not steady after 7 runs." });
    expect(proved.runs).toHaveLength(7);
  });

  it("keeps a failing test when a second look agrees, and asks once about a fault two lines stand on", async () => {
    const { proved, doubted } = await proving(["pff", "pff", "pff"], [{ verdict: "app", finding: fault }, { verdict: "app", known: 1 }], [], [{ verdict: "app", why: "The page says 3 rows and a total of 0." }]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
    expect(doubted).toHaveLength(1);
    expect(doubted[0]).toMatchObject({ line: 1, finding: fault });
  });

  it("puts a line another way when a second look doesn't put its failing on the app", async () => {
    const reword = { verdict: "test", edits: [{ line: 3, op: "replace", with: { type: "check", by: "llm", text: "A total is shown." } }] };
    const { proved, asked, doubted, runsLeft } = await proving(["ppf", "ppf", "ppf", "ppp", "ppp"], [{ verdict: "app", finding: fault }, reword], [], [{ verdict: "other", why: "The rows are the test wallet's own." }]);
    expect(proved).toMatchObject({ proven: true, stands: "passed", findings: [], dismissed: ["The rows are the test wallet's own."] });
    expect(lines(proved.test)[2]).toBe("A total is shown.");
    expect(proved.repairs.join("\n")).toMatch(/a second look didn't put it on the app: The rows are the test wallet's own\./);
    expect(asked[1]).toMatchObject({ line: 2, objection: "The rows are the test wallet's own." });
    expect(doubted).toHaveLength(1);
    expect(runsLeft).toBe(0);
  });

  it("doesn't keep a failing test a second look can't put on the app, when it can't be put another way", async () => {
    const { proved } = await proving(["ppf", "ppf", "ppf"], [{ verdict: "app", finding: fault }, { verdict: "cant-tell" }], [], [{ verdict: "other", why: "Nothing on the page says what the total should be." }]);
    expect(proved).toMatchObject({ proven: false, findings: [] });
    expect(proved.why).toMatch(/fails every time, and a second look didn't put it on the app: Nothing on the page/);
  });

  it("doesn't take a repair that breaks the test, and runs it again as it was", async () => {
    const { proved } = await proving(["ppf", "ppp", "ppp"], [{ verdict: "test", edits: [{ line: 8, op: "remove" }] }]);
    expect(proved).toMatchObject({ proven: true, stands: "passed", repairs: [expect.stringMatching(/wasn't taken/)] });
  });
});
