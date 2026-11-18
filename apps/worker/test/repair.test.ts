import { describe, expect, it } from "vitest";
import { repairAsk } from "@dappdrill/db";
import { newlyStopped } from "../src/jobs/repair.js";

const line = (status: "pass" | "unsure" | "skipped") => ({ status });
const at = (day: number) => new Date(Date.UTC(2026, 10, day));

describe("repairAsk", () => {
  it("repairs a test that stopped on a line of its own, and only runs again one that never got to its lines", () => {
    const ask = repairAsk([
      { testId: "passed", repairable: false, steps: [line("pass")] },
      { testId: "own-line", repairable: true, steps: [line("pass"), line("unsure"), line("skipped")] },
      { testId: "in-setup", repairable: true, steps: [line("skipped"), line("skipped")] },
    ]);
    expect(ask).toEqual({ testIds: ["own-line"], then: ["own-line", "in-setup"] });
  });

  it("asks for nothing when no result needs repairing", () => {
    expect(repairAsk([{ testId: "a", repairable: false, steps: [line("pass")] }])).toEqual({ testIds: [], then: [] });
  });
});

describe("newlyStopped", () => {
  const stopped = [{ testId: "a" }, { testId: "b" }, { testId: "c" }, { testId: "d" }];

  it("leaves out a test that needed repairing the time before and wasn't edited since", () => {
    const before = [
      { testId: "a", result: { repairable: false }, at: at(2) },
      { testId: "b", result: { repairable: true }, at: at(2) },
      { testId: "c", result: { repairable: true }, at: at(2) },
      // d has no result before this one
    ];
    const edited = [
      { testId: "a", at: at(1) },
      { testId: "b", at: at(1) },
      { testId: "c", at: at(3) },
      { testId: "d", at: at(1) },
    ];
    expect(newlyStopped(stopped, before, edited).map((r) => r.testId)).toEqual(["a", "c", "d"]);
  });

  it("takes a result with nothing kept of it as one that didn't need repairing", () => {
    expect(newlyStopped([{ testId: "a" }], [{ testId: "a", result: null, at: at(2) }], [])).toEqual([{ testId: "a" }]);
  });
});
