import { describe, expect, it } from "vitest";
import type { Step, StepResult } from "@dappdrill/core";
import { stepsFromReplay } from "../../src/pipeline/tests.js";

const click = (name: string): Step => ({ kind: "click", target: { role: "button", name } });
const ran = (index: number, status: StepResult["status"], extra: Partial<StepResult> = {}): StepResult => ({ index, status, durationMs: 10, ...extra });

describe("stepsFromReplay", () => {
  // Three test steps; the first has two actions, the second none, the third one.
  const actions = [click("Connect"), click("Approve"), click("Save")];
  const owner = [0, 0, 2];

  it("puts each action's result under the step it came from", () => {
    const steps = stepsFromReplay(3, [ran(0, "pass"), ran(1, "pass"), ran(2, "pass")], owner, actions);
    expect(steps.map((s) => s.status)).toEqual(["pass", "pass", "pass"]);
    expect(steps[0]).toMatchObject({ via: "cache", did: ['Click "Connect"', 'Click "Approve"'], durationMs: 20 });
    expect(steps[1]).toMatchObject({ did: [], durationMs: 0 });
  });

  it("fails the step whose action failed, with its error and screenshot, and skips the rest", () => {
    // The replay stops at the failing action, so nothing after it has a result.
    const steps = stepsFromReplay(3, [ran(0, "pass"), ran(1, "fail", { error: "no Approve button", screenshot: "s1.png" })], owner, actions);
    expect(steps.map((s) => s.status)).toEqual(["fail", "skipped", "skipped"]);
    expect(steps[0]).toMatchObject({ did: ['Click "Connect"'], note: "no Approve button", screenshot: "s1.png" });
  });

  it("marks a step with no actions passed only once the replay got past it", () => {
    expect(stepsFromReplay(3, [ran(0, "pass"), ran(1, "pass")], owner, actions).map((s) => s.status)).toEqual(["pass", "skipped", "skipped"]);
    expect(stepsFromReplay(3, [ran(0, "pass"), ran(1, "pass"), ran(2, "fail")], owner, actions).map((s) => s.status)).toEqual(["pass", "pass", "fail"]);
  });
});
