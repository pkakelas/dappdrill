import { describe, expect, it } from "vitest";
import { outcomeOf, sentence, Test, TestResult, type CodeAssert, type LineResult } from "@dappdrill/core";
import { Doubt } from "../../src/make/doubt.js";
import { prove, type ProveInput } from "../../src/make/prove.js";
import { Repair } from "../../src/make/repair.js";

const drafted = Test.parse({
  id: "go",
  name: "Go",
  goal: "Go somewhere.",
  steps: [
    { type: "action", by: "code", do: "Click Go." },
    { type: "check", by: "code", claim: "It went.", expect: { kind: "shows", text: "Went" } },
    { type: "check", by: "code", claim: "The total is right.", expect: { kind: "shows", text: "Total 3" } },
  ],
});
/** A check as a repair writes it, with its code. */
const check = (text: string) => ({ type: "check", text, expect: { kind: "shows", text } });
const clicks = [{ kind: "click" as const, target: { role: "button", name: "Go" } }];
const STATUS = { p: "pass", f: "fail", u: "unsure", s: "skipped" } as const;
type Letters = string;

/**
 * A run that goes the way its letters say, one per line (p, f, u, s). An action with nothing recorded is
 * done by a model and comes back recorded (`redo`: one whose recording stopped working too), and a check
 * that is only a sentence is a model's.
 */
function ran(test: Test, letters: Letters, more: { redo?: boolean; outcome?: TestResult["outcome"]; reason?: string } = {}): TestResult {
  const steps = test.steps.map((line, i): LineResult => {
    const status = STATUS[(letters[i] ?? "s") as keyof typeof STATUS];
    const base = { status, note: status === "pass" ? "" : `line ${i + 1} ${status}`, did: [], durationMs: 0, costUsd: 0 };
    if (line.type !== "action" || line.by !== "code") return { ...base, by: line.by };
    if (line.run.length && !more.redo) return { ...base, by: "code" };
    return { ...base, by: "llm", redone: line.run.length ? "The page isn't as recorded." : undefined, recorded: status === "pass" ? clicks : undefined };
  });
  const outcome = more.outcome ?? outcomeOf(steps);
  return TestResult.parse({ testId: test.id, outcome, reason: more.reason ?? (outcome === "passed" ? undefined : "It didn't pass."), steps, durationMs: 0, costUsd: 0 });
}

/** A run with no model in which the recording of the first action no longer fits the page. */
function broke(test: Test): TestResult {
  const steps = test.steps.map((line, i): LineResult => ({ status: i ? "skipped" : "unsure", by: line.by, note: i ? "" : "The page isn't as recorded: no button “Go”.", did: [], durationMs: 0, costUsd: 0 }));
  return TestResult.parse({ testId: test.id, outcome: "unverified", reason: "It didn't pass.", repairable: true, steps, durationMs: 0, costUsd: 0 });
}

/** Proves `drafted` against runs and repairs given in order. Says what was asked of the repairer. */
async function proving(runs: (Letters | ((test: Test) => TestResult))[], repairs: object[] = [], problems: ProveInput["problems"] = [], doubts?: object[], more: Partial<ProveInput> = {}) {
  const asked: Parameters<ProveInput["repair"]>[0][] = [];
  const doubted: Parameters<NonNullable<ProveInput["doubt"]>>[0][] = [];
  const notes: string[] = [];
  /** Which runs had a model. */
  const models: boolean[] = [];
  let r = 0;
  let redo = false;
  const proved = await prove({
    test: drafted,
    problems,
    notes,
    asCode: async ({ test, line }) => ({ expect: { kind: "shows", text: sentence(test.steps[line]!) } }),
    ...more,
    run: async (test, { byModel }) => {
      const next = runs[r++];
      if (next === undefined) throw new Error("more runs than expected");
      models.push(byModel);
      // The run after one whose recording broke is the one a model does that action in again.
      const again = redo;
      redo = next === broke;
      return typeof next === "string" ? ran(test, next, { redo: again }) : next(test);
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
  return { proved, asked, doubted, notes, models, runsLeft: runs.length - r };
}

const lines = (test: Test) => test.steps.map(sentence);
const fault = { what: "The total is wrong", expected: "The total of the rows.", saw: "A total of 0." };

describe("prove", () => {
  it("takes a draft that passes: one run with a model to record it, two more with none to see it hold", async () => {
    const { proved, asked, models, runsLeft } = await proving(["ppp", "ppp", "ppp"]);
    expect(proved).toMatchObject({ proven: true, stands: "passed", repairs: [], findings: [] });
    expect(proved.test.steps[0]).toMatchObject({ by: "code", run: clicks });
    expect(models).toEqual([true, false, false]);
    expect(proved.runs).toHaveLength(3);
    expect(asked).toHaveLength(0);
    expect(runsLeft).toBe(0);
  });

  it("puts a wrong line right and proves the test as it is worded then", async () => {
    const edit = { verdict: "test", edits: [{ line: 3, op: "replace", with: check("The total is shown.") }] };
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
    const round = { verdict: "app", finding: fault, note: "The total only shows after a reload.", edits: [{ line: 3, op: "insert-before", with: { type: "action", text: "Reload the page." } }] };
    // The action put in has no recording yet: the run a model does it in proves nothing.
    const { proved, notes, models } = await proving(["ppf", "pppp", "pppp", "pppp"], [round]);
    expect(models).toEqual([true, true, false, false]);
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

  it("has a model do an action again when its recording stopped working, and doesn't count that run", async () => {
    const { proved, models } = await proving(["ppp", broke, "ppp", "ppp", "ppp"]);
    expect(proved).toMatchObject({ proven: true, stands: "passed" });
    expect(models).toEqual([true, false, true, false, false]);
    expect(proved.runs).toHaveLength(5);
  });

  it("gives up on an action whose recording never works on the next run", async () => {
    const { proved, runsLeft } = await proving(["ppp", broke, "ppp", broke, "ppp", broke]);
    expect(proved.proven).toBe(false);
    expect(proved.why).toMatch(/“Click Go.” was done by a model 3 times/);
    expect(runsLeft).toBe(0);
  });

  it("writes a check that is only a sentence as code, from the run a model answered it in", async () => {
    const sentenced = Test.parse({ ...drafted, steps: [drafted.steps[0], { type: "check", by: "llm", claim: "It went." }] });
    const written: number[] = [];
    const asCode = async ({ line }: { line: number }) => (written.push(line), { expect: { kind: "said", text: "Went" } as CodeAssert });
    const { proved, models } = await proving(["pp", "pp", "pp"], [], [], undefined, { test: sentenced, asCode });
    expect(written).toEqual([1]);
    expect(proved).toMatchObject({ proven: true, stands: "passed" });
    expect(proved.test.steps[1]).toEqual({ type: "check", by: "code", claim: "It went.", expect: { kind: "said", text: "Went" } });
    expect(models).toEqual([true, false, false]);
  });

  it("takes out a check no code can say, and doesn't prove a test left with no check", async () => {
    const two = Test.parse({ ...drafted, steps: [...drafted.steps.slice(0, 2), { type: "check", by: "llm", claim: "The chart looks right." }] });
    const asCode = async () => ({ cannot: "Nothing on the page says how a chart looks." });
    const { proved } = await proving(["ppp", "pp", "pp"], [], [], undefined, { test: two, asCode });
    expect(proved).toMatchObject({ proven: true, stands: "passed", repairs: [expect.stringMatching(/“The chart looks right\.” was taken out: no check by code can say it/)] });
    expect(lines(proved.test)).toEqual(["Click Go.", "It went."]);

    const one = Test.parse({ ...drafted, steps: [drafted.steps[0], { type: "check", by: "llm", claim: "The chart looks right." }] });
    const { proved: none } = await proving(["pp"], [], [], undefined, { test: one, asCode });
    expect(none.proven).toBe(false);
    expect(none.why).toMatch(/can't be checked by code, and the test has no other check/);
  });

  it("proves a failure that is in no line: the page threw the same error twice", async () => {
    const threw = (test: Test) => ran(test, "ppp", { outcome: "failed", reason: "The page threw an error: x is undefined" });
    const { proved, asked } = await proving([threw, threw, threw]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ what: "The page threw an error: x is undefined", proven: true }] });
    expect(asked).toHaveLength(0);
  });

  it("decides every line of a run that didn't pass: one fault of the app, one of the test", async () => {
    const reword = { verdict: "test", edits: [{ line: 3, op: "replace", with: check("The total is about right.") }] };
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

  it("says an action the app won't take through a check before it: with no model an action can't fail", async () => {
    const before = { verdict: "app", finding: fault, edits: [{ line: 1, op: "insert-before", with: { type: "check", text: "Go can be clicked.", expect: { kind: "button", name: "Go", is: "enabled" } } }] };
    const { proved, asked, models } = await proving(["fss", "fsss", "fsss"], [before, { verdict: "app", known: 1 }]);
    expect(asked.map((a) => a.line)).toEqual([0, 0]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
    expect(lines(proved.test)[0]).toBe("Go can be clicked.");
    // The action after the failing check is never reached, so no model does anything in those runs.
    expect(models).toEqual([true, true, true]);

    const { proved: left } = await proving(["fss", "fss", "fss", "fss", "fss"], [1, 2, 3, 4].map(() => ({ verdict: "app", finding: fault })));
    expect(left.proven).toBe(false);
    expect(left.repairs[0]).toMatch(/An action can't be left to fail/);
  });

  it("leaves any number of lines to fail without calling it a repair", async () => {
    const stand = (n: number) => ({ verdict: "app", finding: { ...fault, what: `Fault ${n}` } });
    const six = Test.parse({ ...drafted, steps: [drafted.steps[0], ...[1, 2, 3, 4, 5, 6].map((n) => ({ type: "check", by: "code", claim: `Claim ${n}.`, expect: { kind: "shows", text: `Claim ${n}` } }))] });
    const asked: number[] = [];
    const proved = await prove({
      test: six,
      problems: [],
      notes: [],
      run: async (test) => ran(test, "pffffff"),
      asCode: async () => ({ cannot: "not asked" }),
      repair: async (input) => (asked.push(input.line), Repair.parse({ why: "because", ...stand(input.line) })),
    });
    expect(asked).toEqual([1, 2, 3, 4, 5, 6]);
    expect(proved).toMatchObject({ proven: true, stands: "failed" });
    expect(proved.findings.every((f) => f.proven)).toBe(true);
    expect(proved.runs).toHaveLength(3);
  });

  it("stops after four repairs", async () => {
    const reword = (n: number) => ({ verdict: "test", edits: [{ line: 3, op: "replace", with: check(`The total is right, try ${n}.`) }] });
    const { proved, asked } = await proving(["ppf", "ppf", "ppf", "ppf", "ppf"], [1, 2, 3, 4].map(reword));
    expect(asked).toHaveLength(4);
    expect(proved).toMatchObject({ proven: false, why: expect.stringMatching(/^Still not steady after 4 repairs\. “/) });
  });

  it("doesn't take out a check that never passed when the repairs run out", async () => {
    const refused = { verdict: "test", edits: [{ line: 8, op: "remove" }] };
    const { proved } = await proving(["ppf", "ppf", "ppf", "ppf", "ppf"], [refused, refused, refused, refused]);
    expect(proved).toMatchObject({ proven: false, why: expect.stringMatching(/^Still not steady after 4 repairs/) });
    expect(proved.runs).toHaveLength(5);
  });

  it("out of runs, takes out a check that went both ways and keeps the test when two more runs hold", async () => {
    const refused = { verdict: "test", edits: [{ line: 8, op: "remove" }] };
    const { proved, runsLeft } = await proving(["ppp", "ppf", "ppp", "ppf", "ppp", "ppf", "ppp", "pp", "pp"], [refused, refused, refused]);
    expect(proved).toMatchObject({ proven: true, stands: "passed" });
    expect(lines(proved.test)).toEqual(["Click Go.", "It went."]);
    expect(proved.repairs.at(-1)).toMatch(/“The total is right\.” was taken out: it passed in some runs and not in others/);
    expect(proved.runs).toHaveLength(9);
    expect(runsLeft).toBe(0);
  });

  it("gives up when the test without the unsteady check doesn't hold either", async () => {
    const refused = { verdict: "test", edits: [{ line: 8, op: "remove" }] };
    const { proved } = await proving(["ppp", "ppf", "ppp", "ppf", "ppp", "ppf", "ppp", "pp", "pf"], [refused, refused, refused]);
    expect(proved).toMatchObject({ proven: false, why: "Still not steady after 7 runs." });
    expect(proved.runs).toHaveLength(9);
  });

  it("keeps a failing test when a second look agrees, and asks once about a fault two lines stand on", async () => {
    const { proved, doubted } = await proving(["pff", "pff", "pff"], [{ verdict: "app", finding: fault }, { verdict: "app", known: 1 }], [], [{ verdict: "app", why: "The page says 3 rows and a total of 0." }]);
    expect(proved).toMatchObject({ proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
    expect(doubted).toHaveLength(1);
    expect(doubted[0]).toMatchObject({ line: 1, finding: fault });
  });

  it("puts a line another way when a second look doesn't put its failing on the app", async () => {
    const reword = { verdict: "test", edits: [{ line: 3, op: "replace", with: check("A total is shown.") }] };
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

  it("gives up with what was in the way when it is neither the test nor the app", async () => {
    const blocker = "Market buys on NVDA expire unfilled: the markets are illiquid.";
    const { proved, asked, runsLeft } = await proving(["pfs"], [{ verdict: "in-the-way", why: "The order expired: “Illiquid market”.", blocker }]);
    expect(proved).toMatchObject({ proven: false, blocker });
    expect(proved.why).toContain("Illiquid market");
    expect(asked).toHaveLength(1);
    expect(runsLeft).toBe(0);
  });

  it("gives up when a repair didn't change what goes wrong", async () => {
    const reword = (n: number, again?: boolean) => ({ verdict: "test", again, edits: [{ line: 3, op: "replace", with: check(`The total is right, try ${n}.`) }] });
    const { proved, asked, runsLeft } = await proving(["ppf", "ppf", "ppp"], [reword(1), reword(2, true)]);
    expect(proved.proven).toBe(false);
    expect(proved.why).toMatch(/^Repairs didn't change what goes wrong at “The total is right, try 1\.”/);
    expect(asked).toHaveLength(2);
    expect(runsLeft).toBe(1);
  });

  it("looks in the app for why before it runs again without knowing, and decides with what it found", async () => {
    const looked: number[] = [];
    const cause = "The book shows bids and no asks: nobody is selling.";
    const blocker = "Nobody is selling on this market, so buys expire unfilled.";
    const lookInto = async ({ line }: { line: number }) => (looked.push(line), cause);
    const { proved, asked, runsLeft } = await proving(["pfs"], [{ verdict: "cant-tell" }, { verdict: "in-the-way", why: "Nobody sells.", blocker }], [], undefined, { lookInto });
    expect(looked).toEqual([1]);
    expect(asked[1]).toMatchObject({ cause });
    expect(proved).toMatchObject({ proven: false, blocker });
    expect(proved.repairs).toEqual([`Looked into why “It went.” went wrong: ${cause}`]);
    expect(runsLeft).toBe(0);
  });

  it("looks into a line once, and not when the repair already knows why", async () => {
    const looked: number[] = [];
    const lookInto = async ({ line }: { line: number }) => (looked.push(line), "The app doesn't say: the order's details show only Expired.");
    const { proved, asked } = await proving(["fss", "fss"], [{ verdict: "cant-tell" }, { verdict: "cant-tell" }, { verdict: "cant-tell" }], [], undefined, { lookInto });
    expect(looked).toEqual([0]);
    expect(asked.map((a) => a.cause)).toEqual([undefined, "The app doesn't say: the order's details show only Expired.", undefined]);
    expect(proved.why).toMatch(/couldn't be done twice/);

    const { asked: once } = await proving(["ppf", "ppp", "ppp"], [{ verdict: "test", edits: [{ line: 3, op: "replace", with: check("The total shows.") }] }], [], undefined, {
      lookInto: async () => {
        throw new Error("no look expected");
      },
    });
    expect(once).toHaveLength(1);
  });

  it("decides without a look when looking breaks", async () => {
    const { proved, asked } = await proving(["pfs"], [{ verdict: "in-the-way", why: "Expired.", blocker: "Buys expire." }], [], undefined, { lookInto: async () => Promise.reject(new Error("the browser closed")) });
    expect(asked).toHaveLength(1);
    expect(proved.blocker).toBe("Buys expire.");
  });

  it("stops on a shared account when the cleanup didn't take back what a run left", async () => {
    const tidy = { ...drafted, cleanup: [{ type: "action" as const, by: "llm" as const, do: "Close the position." }] };
    const untidy = (test: Test) => ({ ...ran(test, "pfs"), cleanup: [{ status: "fail" as const, by: "llm" as const, note: "The close order expired.", did: [], durationMs: 0, costUsd: 0 }] });
    const shared = await prove({ test: tidy, problems: [], notes: [], shared: true, run: async (t) => untidy(t), asCode: async () => ({ cannot: "not asked" }), repair: async () => { throw new Error("no repair expected"); } });
    expect(shared).toMatchObject({ proven: false, runs: [expect.anything()] });
    expect(shared.blocker).toContain("“Close the position.”: The close order expired.");
    // On a new account each run starts clean, so a cleanup that didn't finish is nothing to stop for.
    const { asked } = await proving([untidy], [{ verdict: "in-the-way", why: "No.", blocker: "No." }], [], undefined, { test: tidy } as Partial<ProveInput>);
    expect(asked).toHaveLength(1);
  });
});
