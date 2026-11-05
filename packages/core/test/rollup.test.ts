import { describe, expect, it } from "vitest";
import { appRollup, appText, conditionsText, flowRollup, flowStatusText, readOf, signingOf, signingText, type Read } from "../src/rollup.js";

const r = (settled: Read["settled"], active?: Read["active"]): Read => ({ settled, active });
const none = { dangerous: 0, check: 0 };
const test = (read: Read, conditions: Read[] = [], signing = none) => ({ read, conditions, signing });

describe("readOf", () => {
  it("keeps the latest finished result while a new run is queued", () => {
    expect(readOf({ status: "queued" }, { status: "fail" })).toEqual({ settled: "fail", active: "queued" });
  });
  it("is Not run yet without a finished result, even while running", () => {
    expect(readOf({ status: "running" }, undefined)).toEqual({ settled: "never", active: "running" });
  });
  it("ignores a stopped run", () => {
    expect(readOf({ status: "stopped" }, { status: "pass" })).toEqual({ settled: "pass" });
  });
  it("shows a skipped condition as Doesn't apply", () => {
    expect(readOf({ status: "skipped" }, { status: "skipped" })).toEqual({ settled: "skipped" });
  });
});

describe("flowRollup", () => {
  it("never reads Passed when a test didn't pass", () => {
    expect(flowRollup([test(r("skipped"))]).status).toBe("partial");
  });
  it("is Not tested without tests, never Passed", () => {
    const f = flowRollup([]);
    expect(f.status).toBe("untested");
    expect(flowStatusText(f)).toBe("Not tested");
  });
  it("fails if any test failed, whatever the conditions did", () => {
    const f = flowRollup([test(r("fail"), [r("pass")]), test(r("pass"))]);
    expect(f.status).toBe("fail");
  });
  it("prefers Couldn't run over Not run yet", () => {
    expect(flowRollup([test(r("error")), test(r("never"))]).status).toBe("error");
  });
  it("passes only when every test passed, and a failed condition doesn't change that", () => {
    const f = flowRollup([test(r("pass"), [r("fail"), r("pass")])]);
    expect(f.status).toBe("pass");
    expect(conditionsText(f)).toBe("1 of 2 passed, 1 failed");
  });
  it("shows counts instead of a status word when partly run", () => {
    const f = flowRollup([test(r("pass")), test(r("never"))]);
    expect(f.status).toBe("partial");
    expect(flowStatusText(f)).toBe("1 of 2 passed");
  });
  it("counts Couldn't run and leaves Doesn't apply out of the denominators", () => {
    const f = flowRollup([test(r("pass"), [r("pass"), r("pass"), r("error"), r("skipped"), r("never")])]);
    expect(conditionsText(f)).toBe("2 of 4 passed, 1 couldn't run, 1 not run yet");
    expect(f.conditions.added).toBe(5);
  });
  it("says when conditions were not added", () => {
    expect(conditionsText(flowRollup([test(r("pass"))]))).toBe("not added");
  });
  it("sums signing flags across tests", () => {
    const f = flowRollup([test(r("pass"), [], signingOf(["dangerous", "consistent"])), test(r("pass"), [], signingOf(["check"]))]);
    expect(f.signing).toEqual({ dangerous: 1, check: 1 });
    expect(signingText(f.signing)).toBe("1 dangerous signature · 1 signature to check");
    expect(signingText(none)).toBeUndefined();
  });
});

describe("appRollup", () => {
  it("writes the sentence with denominators and untested flows apart", () => {
    const a = appRollup([
      flowRollup([test(r("pass"))]),
      flowRollup([test(r("pass"))]),
      flowRollup([test(r("fail"))]),
      flowRollup([]),
    ]);
    expect(a.status).toBe("fail");
    expect(appText(a)).toBe("2 of 3 flows passed, 1 failed · 1 not tested");
  });
  it("is not Passed while a condition failed", () => {
    const a = appRollup([flowRollup([test(r("pass"), [r("fail")])])]);
    expect(a.status).toBe("fail");
    expect(appText(a)).toBe("1 of 1 flow passed, 1 condition failed");
  });
  it("passes when every tested flow passed and no condition failed", () => {
    const a = appRollup([flowRollup([test(r("pass"), [r("pass"), r("skipped")])]), flowRollup([])]);
    expect(a.status).toBe("pass");
    expect(appText(a)).toBe("1 of 1 flow passed · 1 not tested");
  });
  it("has no status word when flows are only partly run", () => {
    const a = appRollup([flowRollup([test(r("pass")), test(r("never"))])]);
    expect(a.status).toBe("partial");
    expect(appText(a)).toBe("0 of 1 flow passed, 1 partly run");
  });
  it("counts flows found but not tested", () => {
    expect(appText(appRollup([flowRollup([]), flowRollup([])]))).toBe("2 flows found, none tested");
  });
});
