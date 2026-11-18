import { describe, expect, it } from "vitest";
import { MakeState } from "@dappdrill/core";
import { makeAlert } from "../src/notify/make.js";

const link = "https://dappdrill.test/apps/app_1";
const state = (goals: Record<string, unknown>[], more: Record<string, unknown> = {}) => MakeState.parse({ stage: "done", goals: goals.map((g, i) => ({ goal: `Goal ${i + 1}`, ...g })), ...more });

describe("makeAlert", () => {
  it("counts the tests kept, and says how they stand", () => {
    const alert = makeAlert("Harbor", "done", state([{ status: "kept", stands: "passed" }, { status: "kept", stands: "passed" }, { status: "kept", stands: "failed" }, { status: "not-kept", whyNot: "Still not steady after 7 runs." }]), link);
    expect(alert.title).toBe("Harbor: 3 tests ready");
    expect(alert.lines).toEqual(["2 tests pass and will run again on every change.", "1 test fails every time on something the app does wrong.", "1 goal got no test. Why is on the app's page."]);
  });

  it("says why when the look came back with nothing", () => {
    const alert = makeAlert("Harbor", "done", state([], { why: "Blocked: the site asks for a CAPTCHA." }), link);
    expect(alert.title).toBe("Harbor: no tests could be made");
    expect(alert.lines).toEqual(["Blocked: the site asks for a CAPTCHA."]);
  });

  it("says what to put right when making stopped at the setup", () => {
    const stuck = { line: 1, sentence: "Connect the wallet.", reason: "The wallet has no funds there.", fix: "funds" };
    const none = makeAlert("Pod", "done", state([{ status: "waiting" }, { status: "waiting" }], { stuck }), link);
    expect(none.title).toBe("Pod: no tests could be made");
    expect(none.lines).toHaveLength(1);
    expect(none.lines[0]).toContain("Add a key that holds funds or say how to get test funds");
    const some = makeAlert("Pod", "done", state([{ status: "kept", stands: "passed" }, { status: "waiting" }], { stuck: { line: 2, sentence: "Sign in.", reason: "The code never arrived." } }), link);
    expect(some.title).toBe("Pod: 1 test ready");
    expect(some.lines).toEqual(["1 test passes and will run again on every change.", "The setup didn't finish: The code never arrived. Check the setup under Settings, then make the tests again."]);
  });

  it("owns up when our side broke", () => {
    expect(makeAlert("Harbor", "failed", null, link).title).toBe("Harbor: the tests couldn't be made");
  });
});
