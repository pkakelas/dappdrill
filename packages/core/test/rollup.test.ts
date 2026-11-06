import { describe, expect, it } from "vitest";
import { appRollup, appText, readOf, setAside, settle, signingOf, signingText, type Read } from "../src/rollup.js";

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

describe("settle", () => {
  const failed = (secondLook: { verdict: "app" | "test" | "unsure"; notOffered?: boolean }) => ({ status: "fail" as const, result: { secondLook } });
  it("sets aside a test that never passed and asks for what the app doesn't offer", () => {
    const run = failed({ verdict: "test", notOffered: true });
    expect(setAside(run, false)).toBe(true);
    expect(settle(run, true, false)).toBe("skipped");
  });
  it("keeps a test that passed before with its owner, since the app may have lost the feature", () => {
    expect(settle(failed({ verdict: "test", notOffered: true }), true, true)).toBe("input");
  });
  it("needs input when the test can be fixed, or the look never said", () => {
    expect(settle(failed({ verdict: "test", notOffered: false }), true, false)).toBe("input");
    expect(settle(failed({ verdict: "test" }), true, false)).toBe("input");
  });
  it("never sets aside a failure of the app", () => {
    expect(settle(failed({ verdict: "app", notOffered: true }), true, false)).toBe("fail");
    expect(settle(failed({ verdict: "unsure" }), true, false)).toBe("probable");
  });
});

describe("appRollup", () => {
  it("never reads Passed when a test didn't pass", () => {
    expect(appRollup([test(r("skipped"))]).status).toBe("partial");
  });
  it("fails if any test failed, whatever the conditions did", () => {
    expect(appRollup([test(r("fail"), [r("pass")]), test(r("pass"))]).status).toBe("fail");
  });
  it("prefers Couldn't run over Not run yet", () => {
    expect(appRollup([test(r("error")), test(r("never"))]).status).toBe("error");
  });
  it("is Not run yet when nothing finished", () => {
    expect(appRollup([test(r("never"))]).status).toBe("never");
  });
  it("writes the sentence with denominators, keeping unwritten tests apart", () => {
    const a = appRollup([test(r("pass")), test(r("pass")), test(r("fail"))], 1);
    expect(a.status).toBe("fail");
    expect(appText(a)).toBe("2 of 3 tests passed, 1 failed · 1 not tested yet");
  });
  it("is not Passed while a condition failed", () => {
    const a = appRollup([test(r("pass"), [r("fail")])]);
    expect(a.status).toBe("fail");
    expect(appText(a)).toBe("1 of 1 test passed, 1 condition failed");
  });
  it("passes when every test passed and no condition failed", () => {
    const a = appRollup([test(r("pass"), [r("pass"), r("skipped")])], 1);
    expect(a.status).toBe("pass");
    expect(appText(a)).toBe("1 of 1 test passed · 1 not tested yet");
  });
  it("has no status word when partly run", () => {
    const a = appRollup([test(r("pass")), test(r("never"))]);
    expect(a.status).toBe("partial");
    expect(appText(a)).toBe("1 of 2 tests passed, 1 not run yet");
  });
  it("is never Passed without a test that ran", () => {
    expect(appRollup([], 2).status).toBe("untested");
    expect(appText(appRollup([], 2))).toBe("2 not tested yet");
    expect(appText(appRollup([]))).toBe("No tests yet");
  });
  it("sums signing flags across tests", () => {
    const a = appRollup([test(r("pass"), [], signingOf(["dangerous", "consistent"])), test(r("pass"), [], signingOf(["check"]))]);
    expect(a.signing).toEqual({ dangerous: 1, check: 1 });
    expect(signingText(a.signing)).toBe("1 dangerous signature · 1 signature to check");
    expect(signingText(none)).toBeUndefined();
  });
});
