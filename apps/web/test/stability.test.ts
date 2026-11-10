import { describe, expect, it } from "vitest";
import { stabilityText } from "../src/components/tests/stability";

describe("stabilityText", () => {
  it("says nothing with no finished runs", () => {
    expect(stabilityText(undefined)).toBeNull();
    expect(stabilityText({ runs: 0, agentRuns: 0, avgCostUsd: null })).toBeNull();
  });

  it("says the saved steps carried every run, and what one cost", () => {
    expect(stabilityText({ runs: 6, agentRuns: 0, avgCostUsd: 0.0812 })).toBe("Replayed from saved steps on all of the last 6 runs · about $0.08 a run");
  });

  it("counts the runs the agent stepped into", () => {
    expect(stabilityText({ runs: 6, agentRuns: 3, avgCostUsd: 0.41 })).toBe("The agent stepped in on 3 of the last 6 runs · about $0.41 a run");
    expect(stabilityText({ runs: 4, agentRuns: 4, avgCostUsd: null })).toBe("The agent stepped in on all of the last 4 runs");
  });

  it("reads naturally with one run", () => {
    expect(stabilityText({ runs: 1, agentRuns: 0, avgCostUsd: 0 })).toBe("Replayed from saved steps on the last run");
    expect(stabilityText({ runs: 1, agentRuns: 1, avgCostUsd: 0.002 })).toBe("The agent stepped in on the last run · under $0.01 a run");
  });
});
