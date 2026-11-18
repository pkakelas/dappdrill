import { beforeEach, describe, expect, it, vi } from "vitest";
import { LineResult, outcomeOf, Test, TestResult, type DrillEvent, type Suite } from "@dappdrill/core";
import type { Llm } from "../../src/types.js";
import { asTest, wrongValues } from "../../src/make/draft.js";
import { applyRepair, repair, Repair, writeCheck } from "../../src/make/repair.js";
import { repairSuite } from "../../src/make/repair-suite.js";
import { NOTHING_TO_DO } from "../../src/run/running.js";
import { openSuite, type Fresh, type OpenSuite } from "../../src/run/suite.js";

// A repair is told how runs went: the runs themselves are scripted here.
vi.mock("../../src/run/suite.js", async (original) => ({ ...(await original<typeof import("../../src/run/suite.js")>()), openSuite: vi.fn() }));

const click = { kind: "click" as const, target: { role: "button", name: "Deposit" } };
const test = Test.parse({
  id: "deposit",
  name: "Deposit",
  goal: "Deposit some.",
  values: { amount: { from: 10, to: 20 } },
  steps: [
    { type: "action", by: "code", do: "Type {{amount}} into Amount.", run: [{ kind: "fill", target: { label: "Amount" }, value: "{{amount}}" }] },
    { type: "action", by: "code", do: "Click Deposit and approve.", run: [click, { kind: "wallet", respond: "approve" }] },
    { type: "check", by: "code", claim: "It was mined.", expect: { kind: "mined" } },
    { type: "check", by: "llm", claim: "The page says {{amount}} was deposited at 12:04." },
  ],
});
const fix = (edits: unknown[], more: object = {}) => Repair.parse({ verdict: "test", why: "w", edits, ...more });
const made = (r: ReturnType<typeof applyRepair>) => ("test" in r ? r.test : undefined);

describe("applyRepair", () => {
  it("rewords one line and leaves the others with their recordings", () => {
    const out = made(applyRepair(test, fix([{ line: 4, op: "replace", with: { type: "check", text: "The page says {{amount}} was deposited." } }])))!;
    expect(out.steps.slice(0, 3)).toEqual(test.steps.slice(0, 3));
    expect(out.steps[3]).toEqual({ type: "check", by: "llm", claim: "The page says {{amount}} was deposited." });
  });

  it("keeps the recording of an action replaced by the same words, and drops it for new words", () => {
    const sameWords = made(applyRepair(test, fix([{ line: 2, op: "replace", with: { type: "action", text: "Click Deposit and approve." } }])))!;
    expect(sameWords.steps[1]).toEqual(test.steps[1]);
    const newWords = made(applyRepair(test, fix([{ line: 2, op: "replace", with: { type: "action", text: "Click “Deposit” and approve the request." } }])))!;
    expect(newWords.steps[1]).toEqual({ type: "action", by: "code", do: "Click “Deposit” and approve the request.", run: [] });
  });

  it("makes several edits by the numbers the lines had when they were listed", () => {
    const out = made(
      applyRepair(
        test,
        fix([
          { line: 2, op: "insert-before", with: { type: "action", text: "Close the tour if it is open." } },
          { line: 3, op: "remove" },
          { line: 4, op: "replace", with: { type: "check", text: "It says so.", expect: { kind: "said", text: "Deposited {{amount}}" } } },
        ]),
      ),
    )!;
    expect(out.steps.map((s) => (s.type === "action" ? s.do : s.claim))).toEqual(["Type {{amount}} into Amount.", "Close the tour if it is open.", "Click Deposit and approve.", "It says so."]);
  });

  it("refuses an edit that leaves the test broken", () => {
    expect(applyRepair(test, fix([{ line: 9, op: "remove" }]))).toHaveProperty("wrong");
    expect(applyRepair(test, fix([{ line: 3, op: "replace" }]))).toHaveProperty("wrong");
    expect(applyRepair(test, fix([{ line: 2, op: "replace", with: { type: "action", text: "Click Deposit.", expect: { kind: "mined" } } }]))).toEqual({ wrong: "Line 2 is an action with an expect. Only a check has one." });
    expect(applyRepair(test, fix([{ line: 3, op: "remove" }, { line: 4, op: "remove" }]))).toHaveProperty("wrong");
    // The only lines that named the value are gone, and the value is still there.
    expect(applyRepair(test, fix([{ line: 1, op: "remove" }, { line: 4, op: "remove" }]))).toHaveProperty("wrong");
  });

  it("takes a check that is only a sentence: it isn't code until it is written as code", () => {
    const out = made(applyRepair(test, fix([{ line: 3, op: "replace", with: { type: "check", text: "It went through." } }])))!;
    expect(out.steps[2]).toEqual({ type: "check", by: "llm", claim: "It went through." });
  });

  it("takes new values with the lines that use them", () => {
    const out = made(
      applyRepair(test, fix([{ line: 4, op: "replace", with: { type: "check", text: "The page says {{amount}} was deposited for a fee of {{fee}}." } }], { values: [{ name: "amount", from: 10, to: 20 }, { name: "fee", from: 1, to: 2 }] })),
    )!;
    expect(Object.keys(out.values)).toEqual(["amount", "fee"]);
  });
});

describe("a test as a model writes it", () => {
  const written = {
    name: "Deposit 100 hUSDC!",
    startPath: "/vault",
    values: [{ name: "amount", from: 10, to: 20, decimals: 2 }],
    lines: [
      { type: "action" as const, text: "Type {{amount}} into Amount." },
      { type: "check" as const, text: "Cash fell.", expect: { kind: "changes" as const, figure: "Cash", by: "-{{amount}}" } },
    ],
    cleanup: ["Withdraw whatever was deposited."],
    notes: [],
    problems: [],
  };

  it("becomes a test whose actions, and its cleanup, have nothing recorded yet", () => {
    const out = asTest(written, "Deposit some.");
    expect(out).toMatchObject({ test: { id: "deposit-100-husdc", goal: "Deposit some.", steps: [{ by: "code", run: [] }, { by: "code" }], cleanup: [{ by: "code", run: [] }] } });
  });

  it("keeps a check no kind can say as a sentence", () => {
    const out = asTest({ ...written, lines: [...written.lines, { type: "check", text: "The chart looks right." }] }, "g");
    expect(out).toMatchObject({ test: { steps: [{}, {}, { type: "check", by: "llm", claim: "The chart looks right." }] } });
  });

  it("is refused with words that say what to put right", () => {
    expect(asTest({ ...written, lines: [{ ...written.lines[0]!, expect: { kind: "mined" } }, written.lines[1]!] }, "g")).toEqual({ wrong: "Line 1 is an action with an expect. Only a check has one." });
    expect(asTest({ ...written, lines: [written.lines[0]!, written.lines[0]!] }, "g")).toEqual({ wrong: "There is no check." });
    expect(asTest({ ...written, values: [] }, "g")).toEqual({ wrong: "{{amount}} is used but isn't among the values." });
  });
});

describe("wrongValues", () => {
  it("finds a value nobody uses and a range that runs backwards", () => {
    expect(wrongValues({ ...test, values: { ...test.values, fee: { from: 1, to: 2, decimals: 2 } } })).toMatch(/fee is never used/);
    expect(wrongValues({ ...test, values: { amount: { from: 20, to: 10, decimals: 2 } } })).toMatch(/runs from 20 to 10/);
    expect(wrongValues(test)).toBeUndefined();
  });
});

describe("repair", () => {
  it("is shown how each run's cleanup went, so it can tell an account an earlier run left behind", async () => {
    let prompt = "";
    const llm = { structured: async (o: { prompt: string }) => ((prompt = o.prompt), Repair.parse({ verdict: "in-the-way", why: "w", blocker: "b" })) } as unknown as Llm;
    const line = (status: "pass" | "fail", note = "") => ({ status, by: "llm", note, did: [], durationMs: 0, costUsd: 0 });
    const run = TestResult.parse({ testId: "deposit", outcome: "failed", steps: [line("pass"), line("fail", "No funds.")], cleanup: [line("fail", "The withdraw expired.")], durationMs: 0, costUsd: 0 });
    const fixed = await repair(llm, { test: { ...test, cleanup: [{ type: "action", by: "llm", do: "Withdraw it." }] }, runs: [run], line: 1, flips: false, earlier: [], notes: [], problems: [], artifactsDir: "/nowhere" });
    expect(fixed.verdict).toBe("in-the-way");
    expect(prompt).toContain("  Cleanup: 1. fail: The withdraw expired.");
  });
});

describe("writeCheck", () => {
  const line = (status: "pass" | "fail", note = "") => ({ status, by: "llm", note, page: "Deposited 12.50 at 12:04", did: [], durationMs: 0, costUsd: 0 });
  const run = TestResult.parse({ testId: "deposit", outcome: "passed", values: { amount: "12.50" }, steps: [line("pass"), line("pass"), line("pass"), line("pass", "It says 12.50.")], durationMs: 0, costUsd: 0 });
  const asked = (answer: object) => {
    const seen: { prompt: string; name: string }[] = [];
    const llm = { structured: async (o: { prompt: string; name: string }) => (seen.push(o), answer) } as unknown as Llm;
    return { llm, seen };
  };

  it("hands back the code a model wrote, having shown it the page and what was answered there", async () => {
    const { llm, seen } = asked({ expect: { kind: "said", text: "Deposited {{amount}}" } });
    expect(await writeCheck(llm, { test, run, line: 3, artifactsDir: "/nowhere" })).toEqual({ expect: { kind: "said", text: "Deposited {{amount}}" } });
    expect(seen[0]!.name).toBe("check");
    expect(seen[0]!.prompt).toContain("Write line 4 as code. A model answered it: pass. It says 12.50.");
    expect(seen[0]!.prompt).toContain("{{amount}} = 12.50");
    expect(seen[0]!.prompt).toContain("4. [check] The page says {{amount}} was deposited at 12:04.  (a sentence only, no expect yet)");
    expect(seen[0]!.prompt).toContain("Deposited 12.50 at 12:04");
  });

  it("says so when no kind can say the claim", async () => {
    expect(await writeCheck(asked({ cannot: "Nothing reads a clock." }).llm, { test, run, line: 3, artifactsDir: "/nowhere" })).toEqual({ cannot: "Nothing reads a clock." });
    expect(await writeCheck(asked({}).llm, { test, run, line: 3, artifactsDir: "/nowhere" })).toEqual({ cannot: "No kind of check can say it." });
  });

  it("is told what was written before, when that went another way with no model", async () => {
    const { llm, seen } = asked({ expect: { kind: "shows", text: "Deposited" } });
    const went = TestResult.parse({ ...run, outcome: "failed", steps: [...run.steps.slice(0, 3), { ...line("fail", "“Deposited 12.5” isn't on the page."), by: "code" }] });
    await writeCheck(llm, { test, run: went, line: 3, tried: { expect: { kind: "shows", text: "Deposited 12.5" }, answered: run.steps[3]! }, artifactsDir: "/nowhere" });
    expect(seen[0]!.prompt).toContain("A model answered it: pass. It says 12.50.");
    expect(seen[0]!.prompt).toContain('It was written as {"kind":"shows","text":"Deposited 12.5"}, and on the page below that came out another way: fail. “Deposited 12.5” isn\'t on the page.');
  });
});

describe("repairSuite", () => {
  const clicks = [{ kind: "click" as const, target: { role: "button", name: "Go" } }];
  const unrecorded = (text: string) => ({ type: "action" as const, by: "code" as const, do: text, run: [] });
  const recorded = (text: string) => ({ ...unrecorded(text), run: clicks });
  const shows = (text: string) => ({ type: "check" as const, by: "code" as const, claim: `It says ${text}.`, expect: { kind: "shows" as const, text } });
  const go = (id: string, steps: object[]) => Test.parse({ id, name: id, goal: id, steps });
  /** Not code yet: an action with nothing recorded and a check that is only a sentence. */
  const drafted = go("drafted", [unrecorded("Click Go."), { type: "check", by: "llm", claim: "It went." }]);
  /** Code all through. */
  const written = go("written", [recorded("Click Go."), shows("Went")]);
  const suiteOf = (tests: Test[], more: Partial<Suite> = {}): Suite => ({ notes: [], signing: "allowed", tests, ...more }) as Suite;
  const STATUS = { p: "pass", f: "fail", u: "unsure", s: "skipped" } as const;

  /** How a line went. A model's run records an action that had nothing recorded, and answers a check that is only a sentence. */
  const lineOf = (line: Test["steps"][number], letter: string, byModel: boolean, redo = false): LineResult => {
    const status = STATUS[letter as keyof typeof STATUS];
    const model = byModel && (line.type === "check" ? line.by === "llm" : line.by === "llm" || !line.run.length || redo);
    return LineResult.parse({ status, by: model ? "llm" : "code", note: status === "pass" ? "" : `It ${status}.`, recorded: model && line.type === "action" && status === "pass" ? clicks : undefined });
  };
  type Run = string | { broke: true } | { redo: string };
  const result = (test: Test, run: Run, byModel: boolean): TestResult => {
    if (typeof run === "object" && "broke" in run) {
      const steps = test.steps.map((l, i) => LineResult.parse({ status: i ? "skipped" : "unsure", by: l.by, note: i ? "" : "The page isn't as recorded: no button “Go”." }));
      return TestResult.parse({ testId: test.id, outcome: "unverified", reason: "The page isn't as recorded.", repairable: true, steps, durationMs: 0, costUsd: 0 });
    }
    const letters = typeof run === "string" ? run : run.redo;
    const steps = test.steps.map((l, i) => lineOf(l, letters[i] ?? "s", byModel, typeof run === "object"));
    const outcome = outcomeOf(steps);
    return TestResult.parse({ testId: test.id, outcome, reason: outcome === "passed" ? undefined : "The check didn't pass.", steps, durationMs: 0, costUsd: 0 });
  };

  interface Opened {
    /** Each run of a test, in order. */
    runs?: Run[];
    stuck?: string;
    setup?: LineResult[];
    /** What each clean start gives. */
    fresh?: Partial<Fresh>[];
    account?: "kept" | "new";
  }
  let opens: { suite: Suite; byModel?: boolean; closed: boolean; models: boolean[]; ran: Test[] }[];
  /** What a model is asked to write as code, and what it answers, in order. */
  let checks: object[];
  let wrote: string[];

  /** Each time the suite is opened, the next of these. */
  function opening(...each: Opened[]) {
    vi.mocked(openSuite).mockImplementation(async (input, _sink, more) => {
      const script = each[opens.length];
      if (!script) throw new Error("opened more often than expected");
      const here = { suite: input.suite, byModel: more?.byModel, closed: false, models: [] as boolean[], ran: [] as Test[] };
      opens.push(here);
      const runs = [...(script.runs ?? [])];
      const fresh = [...(script.fresh ?? [])];
      const llm = {
        structured: async (o: { prompt: string }) => {
          wrote.push(o.prompt);
          const answer = checks.shift();
          if (!answer) throw new Error("asked to write more checks than expected");
          return answer;
        },
      };
      return {
        env: { target: { account: script.account ?? "new" }, costUsd: () => 0.5, fastLlm: () => llm },
        opts: {},
        stuck: script.stuck,
        setup: script.setup,
        fresh: async () => fresh.shift() ?? {},
        run: async (test: Test, with_: { byModel?: boolean } = {}) => {
          const next = runs.shift();
          if (next === undefined) throw new Error("more runs than expected");
          here.models.push(Boolean(with_.byModel));
          here.ran.push(test);
          return result(test, next, Boolean(with_.byModel));
        },
        close: async () => void (here.closed = true),
      } as unknown as OpenSuite;
    });
  }
  const input = (suite: Suite, more: object = {}) => ({ target: { url: "http://localhost/" } as never, suite, artifactsDir: "/nowhere", ...more });

  beforeEach(() => {
    opens = [];
    checks = [];
    wrote = [];
    vi.mocked(openSuite).mockReset();
  });

  it("records what a model did, writes a sentence as code, and hands the test back once two runs with no model went the same way", async () => {
    opening({ runs: ["pp", "pp", "pp"] });
    checks = [{ expect: { kind: "shows", text: "Went" } }];
    const events: DrillEvent[] = [];
    const told: string[] = [];
    const out = await repairSuite(input(suiteOf([written, drafted])), (e) => void events.push(e), { onStart: (id) => told.push(`start ${id}`), onTest: (done) => void told.push(`done ${done.testId}`) });

    expect(out.tests).toEqual([{ testId: "drafted", test: { ...drafted, steps: [recorded("Click Go."), { type: "check", by: "code", claim: "It went.", expect: { kind: "shows", text: "Went" } }] } }]);
    expect(out.setup).toBeUndefined();
    expect(told).toEqual(["start drafted", "done drafted"]);
    // Opened once, for making; only the first run of the test had a model.
    expect(opens.map((o) => o.byModel)).toEqual([true]);
    expect(opens[0]!.models).toEqual([true, false, false]);
    expect(opens[0]!.closed).toBe(true);
    // The runs with no model were of the test as code.
    expect(opens[0]!.ran[1]!.steps.every((l) => l.by === "code")).toBe(true);
    expect(wrote).toHaveLength(1);
    expect(out.costUsd).toBe(0.5);
    expect(events.at(-1)).toEqual({ type: "cost", usd: 0.5 });
  });

  it("does the setup alone when every line is code and no test was named", async () => {
    opening({});
    const out = await repairSuite(input(suiteOf([written])));
    expect(out.tests).toEqual([]);
    expect(out.setup).toBeUndefined();
    expect(opens.map((o) => [o.byModel, o.ran.length, o.closed])).toEqual([[true, 0, true]]);
  });

  it("leaves a named test whose lines all work as code: one that passes as it is, one that fails with why", async () => {
    opening({ runs: ["pp", "pp", "pf"] });
    const failing = { ...written, id: "failing" };
    const out = await repairSuite(input(suiteOf([written, failing]), { testIds: ["written", "failing"] }));
    expect(out.tests).toEqual([
      { testId: "written", test: written },
      { testId: "failing", why: "Its lines all work as code, and it fails: The check didn't pass." },
    ]);
    expect(wrote).toEqual([]);
  });

  it("writes a check once more when it reads the page another way than the model did, and then gives the test up", async () => {
    opening({ runs: ["pp", "pf", "pf"] });
    checks = [{ expect: { kind: "shows", text: "Went" } }, { expect: { kind: "said", text: "Went" } }];
    const out = await repairSuite(input(suiteOf([drafted])));
    expect(out.tests).toEqual([{ testId: "drafted", why: "“It went.” went another way with no model (It fail.) than with one (pass)." }]);
    expect(wrote[1]).toContain('It was written as {"kind":"shows","text":"Went"}');
    // The third run was of the check as it was written the second time.
    expect(opens[0]!.ran[2]!.steps[1]).toMatchObject({ expect: { kind: "said" } });
  });

  it("doesn't repair a test with a check no code can say", async () => {
    opening({ runs: ["pp"] });
    checks = [{ cannot: "Nothing reads a chart." }];
    const out = await repairSuite(input(suiteOf([drafted])));
    expect(out.tests).toEqual([{ testId: "drafted", why: "No check by code can say “It went.”. Nothing reads a chart." }]);
  });

  it("says which line a model couldn't do either", async () => {
    opening({ runs: ["u"] });
    const out = await repairSuite(input(suiteOf([drafted])));
    expect(out.tests).toEqual([{ testId: "drafted", why: "“Click Go.” couldn't be done by a model either: It unsure." }]);
  });

  it("has a model do the test once more when what it recorded doesn't work with no model, and no more than that", async () => {
    opening({ runs: ["pp", { broke: true }, { redo: "pp" }, { broke: true }] });
    checks = [{ expect: { kind: "shows", text: "Went" } }];
    const out = await repairSuite(input(suiteOf([drafted])));
    expect(opens[0]!.models).toEqual([true, false, true, false]);
    expect(out.tests).toEqual([{ testId: "drafted", why: "What a model did for “Click Go.” was recorded twice, and didn't work with no model: The page isn't as recorded: no button “Go”." }]);
  });

  it("asks a model again about an action recorded as nothing to do", async () => {
    opening({ runs: ["pp", "pp", "pp"] });
    const nothing = go("nothing", [{ ...unrecorded("Close the tour if it is open."), run: [NOTHING_TO_DO] }, shows("Went")]);
    const out = await repairSuite(input(suiteOf([nothing]), { testIds: ["nothing"] }));
    expect(opens[0]!.ran[0]!.steps[0]).toMatchObject({ run: [] });
    expect(out.tests[0]!.test!.steps[0]).toMatchObject({ run: clicks });
  });

  it("records the setup first, proves it with no model, and with no tests named does only that", async () => {
    const setup = { startPath: "/", steps: [unrecorded("Connect the wallet.")] };
    opening({ setup: [lineOf(setup.steps[0]!, "p", true)] }, {});
    const out = await repairSuite(input(suiteOf([drafted], { setup }), { testIds: [] }));
    expect(out).toMatchObject({ setup: { startPath: "/", steps: [recorded("Connect the wallet.")] }, tests: [] });
    expect(out.reset).toBeUndefined();
    // Opened again with what was recorded, and no model.
    expect(opens.map((o) => o.byModel)).toEqual([true, undefined]);
    expect(opens[1]!.suite.setup).toEqual(out.setup);
    expect(opens.map((o) => o.closed)).toEqual([true, true]);
  });

  it("doesn't keep a setup that only worked with a model, and repairs no test from it", async () => {
    const setup = { startPath: "/", steps: [unrecorded("Connect the wallet.")] };
    opening({ setup: [lineOf(setup.steps[0]!, "p", true)] }, { stuck: "The page isn't as recorded: no button “Go”." });
    const out = await repairSuite(input(suiteOf([drafted], { setup })));
    expect(out.setup).toBeUndefined();
    expect(out.tests).toEqual([{ testId: "drafted", why: "What a model did was recorded, and it didn't work with no model. The page isn't as recorded: no button “Go”." }]);
  });

  it("does the reset of a kept account again when it was recorded as nothing to do", async () => {
    const reset = { startPath: "/orders", steps: [{ ...unrecorded("Cancel the open order."), run: [NOTHING_TO_DO] }] };
    opening({ account: "kept", fresh: [{ reset: [lineOf(unrecorded("Cancel the open order."), "p", true)] }] }, { account: "kept" });
    const out = await repairSuite(input(suiteOf([written], { reset }), { testIds: [] }));
    expect(opens[0]!.suite.reset!.steps[0]).toMatchObject({ run: [] });
    expect(out.reset).toEqual({ startPath: "/orders", steps: [recorded("Cancel the open order.")] });
    expect(out.setup).toBeUndefined();
  });

  it("gives every test the reason when the first start couldn't be made, or the spending limit is reached", async () => {
    opening({ stuck: "The new account wasn't paid." });
    expect((await repairSuite(input(suiteOf([drafted, { ...drafted, id: "other" }])))).tests).toEqual([
      { testId: "drafted", why: "The new account wasn't paid." },
      { testId: "other", why: "The new account wasn't paid." },
    ]);
    opens = [];
    opening({});
    expect((await repairSuite(input(suiteOf([drafted]), { maxUsd: 0.25 }))).tests).toEqual([{ testId: "drafted", why: "Stopped at the $0.25 spending limit." }]);
  });
});
