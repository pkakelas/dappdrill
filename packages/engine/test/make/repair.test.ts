import { describe, expect, it } from "vitest";
import { Test } from "@dappdrill/core";
import { asTest, wrongValues } from "../../src/make/draft.js";
import { applyRepair, Repair } from "../../src/make/repair.js";

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
    const out = made(applyRepair(test, fix([{ line: 4, op: "replace", with: { type: "check", by: "llm", text: "The page says {{amount}} was deposited." } }])))!;
    expect(out.steps.slice(0, 3)).toEqual(test.steps.slice(0, 3));
    expect(out.steps[3]).toEqual({ type: "check", by: "llm", claim: "The page says {{amount}} was deposited." });
  });

  it("keeps the recording of an action replaced by the same words, and drops it for new words", () => {
    const sameWords = made(applyRepair(test, fix([{ line: 2, op: "replace", with: { type: "action", by: "code", text: "Click Deposit and approve." } }])))!;
    expect(sameWords.steps[1]).toEqual(test.steps[1]);
    const newWords = made(applyRepair(test, fix([{ line: 2, op: "replace", with: { type: "action", by: "code", text: "Click “Deposit” and approve the request." } }])))!;
    expect(newWords.steps[1]).toEqual({ type: "action", by: "code", do: "Click “Deposit” and approve the request.", run: [] });
  });

  it("makes several edits by the numbers the lines had when they were listed", () => {
    const out = made(
      applyRepair(
        test,
        fix([
          { line: 2, op: "insert-before", with: { type: "action", by: "llm", text: "Close the tour if it is open." } },
          { line: 3, op: "remove" },
          { line: 4, op: "replace", with: { type: "check", by: "code", text: "It says so.", expect: { kind: "said", text: "Deposited {{amount}}" } } },
        ]),
      ),
    )!;
    expect(out.steps.map((s) => (s.type === "action" ? s.do : s.claim))).toEqual(["Type {{amount}} into Amount.", "Close the tour if it is open.", "Click Deposit and approve.", "It says so."]);
  });

  it("refuses an edit that leaves the test broken", () => {
    expect(applyRepair(test, fix([{ line: 9, op: "remove" }]))).toHaveProperty("wrong");
    expect(applyRepair(test, fix([{ line: 3, op: "replace" }]))).toHaveProperty("wrong");
    expect(applyRepair(test, fix([{ line: 3, op: "replace", with: { type: "check", by: "code", text: "Mined." } }]))).toHaveProperty("wrong");
    expect(applyRepair(test, fix([{ line: 3, op: "remove" }, { line: 4, op: "remove" }]))).toHaveProperty("wrong");
    // The only lines that named the value are gone, and the value is still there.
    expect(applyRepair(test, fix([{ line: 1, op: "remove" }, { line: 4, op: "remove" }]))).toHaveProperty("wrong");
  });

  it("takes new values with the lines that use them", () => {
    const out = made(
      applyRepair(test, fix([{ line: 4, op: "replace", with: { type: "check", by: "llm", text: "The page says {{amount}} was deposited for a fee of {{fee}}." } }], { values: [{ name: "amount", from: 10, to: 20 }, { name: "fee", from: 1, to: 2 }] })),
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
      { type: "action" as const, by: "code" as const, text: "Type {{amount}} into Amount." },
      { type: "check" as const, by: "code" as const, text: "Cash fell.", expect: { kind: "changes" as const, figure: "Cash", by: "-{{amount}}" } },
    ],
    cleanup: ["Withdraw whatever was deposited."],
    notes: [],
    problems: [],
  };

  it("becomes a test whose code actions have nothing recorded yet", () => {
    const out = asTest(written, "Deposit some.");
    expect(out).toMatchObject({ test: { id: "deposit-100-husdc", goal: "Deposit some.", steps: [{ by: "code", run: [] }, { by: "code" }], cleanup: [{ by: "llm" }] } });
  });

  it("is refused with words that say what to put right", () => {
    expect(asTest({ ...written, lines: [written.lines[0]!, { type: "check", by: "code", text: "Cash fell." }] }, "g")).toEqual({ wrong: "Line 2 is a check by code with no expect." });
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
