import { describe, expect, it } from "vitest";
import type { Step, TestStep, TestStepResult } from "@dappdrill/core";
import { passingChecks, placeChecks } from "../../src/explore/kept-checks.js";
import { failedCheck } from "../../src/pipeline/tests.js";

const click = (name: string): Step => ({ kind: "click", target: { role: "button", name } });
const recorded: Step[] = [click("Long"), click("Orders"), click("Open"), click("Home")];
const wellFormed = { name: "Numbers well-formed", assert: { kind: "well-formed" as const } };
const addsUp = { name: "Value is size times mark", assert: { kind: "adds-up" as const, value: "Size × Mark = Value" } };

describe("placeChecks", () => {
  // The recording lined up with the steps: step 1 took the first action, step 2 the next two, the last action was a detour.
  const lined: TestStep[] = [
    { text: "Click Long", actions: [recorded[0]!] },
    { text: "Open the Orders tab", actions: [recorded[1]!, recorded[2]!] },
    { text: "Check the order shows" },
  ];

  it("puts a check on the step that holds the action before it", () => {
    const out = placeChecks(lined, [{ ...wellFormed, after: 1 }, { ...addsUp, after: 3 }], recorded, true);
    expect(out[0]!.checks).toEqual([wellFormed]);
    expect(out[1]!.checks).toEqual([addsUp]);
    expect(out[2]!.checks).toBeUndefined();
  });

  it("puts a check made at the end of the path on the last step, lined up or not", () => {
    expect(placeChecks(lined, [{ ...addsUp, after: 4 }], recorded, true)[2]!.checks).toEqual([addsUp]);
    const plain = lined.map((s) => ({ text: s.text }));
    expect(placeChecks(plain, [{ ...addsUp, after: 4 }], recorded, false)[2]!.checks).toEqual([addsUp]);
  });

  it("leaves out a check made mid-path when the steps aren't the recording, or before any step's action", () => {
    const plain = lined.map((s) => ({ text: s.text }));
    expect(placeChecks(plain, [{ ...wellFormed, after: 2 }], recorded, false).every((s) => !s.checks)).toBe(true);
    expect(placeChecks(lined, [{ ...wellFormed, after: 0 }], recorded, true).every((s) => !s.checks)).toBe(true);
  });

  it("goes back past a detour to the step before it, and keeps one claim once", () => {
    const detour: TestStep[] = [{ text: "Click Long", actions: [recorded[0]!] }, { text: "Open Home", actions: [recorded[3]!] }];
    const out = placeChecks(detour, [{ ...wellFormed, after: 3 }, { ...wellFormed, after: 3 }], recorded, true);
    expect(out[0]!.checks).toEqual([wellFormed]);
    expect(out[1]!.checks).toBeUndefined();
  });

  it("doesn't touch the steps it was given", () => {
    const before = structuredClone(lined);
    placeChecks(lined, [{ ...wellFormed, after: 1 }], recorded, true);
    expect(lined).toEqual(before);
  });
});

describe("passingChecks", () => {
  it("keeps only the checks that passed, by their place on the step", () => {
    const steps: TestStep[] = [{ text: "Open Home", actions: [recorded[3]!], checks: [wellFormed, addsUp] }, { text: "Reload", checks: [wellFormed] }];
    const results: TestStepResult[] = [
      { status: "pass", did: [], durationMs: 0, checks: [{ name: wellFormed.name, status: "fail", evidence: "NaN" }, { name: addsUp.name, status: "pass", evidence: "ok" }] },
      { status: "pass", did: [], durationMs: 0, checks: [{ name: wellFormed.name, status: "error", evidence: "no label" }] },
    ];
    expect(passingChecks(steps, results)).toEqual([{ text: "Open Home", actions: [recorded[3]!], checks: [addsUp] }, { text: "Reload" }]);
  });
});

describe("failedCheck", () => {
  it("names the first check that didn't hold, after its step", () => {
    const steps: Pick<TestStepResult, "checks">[] = [{}, { checks: [{ name: "A", status: "error", evidence: "couldn't" }] }, { checks: [{ name: "B", status: "fail", evidence: "The left side comes to 1, but the page shows 2." }] }];
    expect(failedCheck(steps)).toBe("After step 3, “B” didn't hold: The left side comes to 1, but the page shows 2.");
    expect(failedCheck(steps.slice(0, 2))).toBeUndefined();
  });
});
