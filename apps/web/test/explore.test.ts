import type { ExploreBug } from "@dappdrill/core";
import { describe, expect, it } from "vitest";
import { appBugs } from "../src/lib/explore";

const bug = (id: string, name: string, status: ExploreBug["status"] = "confirmed"): ExploreBug => ({
  id,
  explorerId: "x",
  feature: "Withdraw",
  name,
  summary: "",
  steps: [],
  expected: "",
  actual: "",
  severity: "high",
  status,
  source: "explorer",
  seen: 1,
  evidence: { chain: [], console: [], network: [] },
  at: "2026-01-01T00:00:00.000Z",
});

describe("an app's bugs across explorations", () => {
  it("shows a bug once, from the newest exploration that confirmed it", () => {
    const { open } = appBugs([
      { id: "new", triage: {}, bugs: [bug("b2", "Withdraw reverts")] },
      { id: "old", triage: {}, bugs: [bug("b1", "withdraw reverts"), bug("b0", "Old bug")] },
    ]);
    expect(open.map((b) => [b.passId, b.bug.id])).toEqual([
      ["new", "b2"],
      ["old", "b0"],
    ]);
  });

  it("keeps what a person decided when the bug is found again", () => {
    const { open, setAside } = appBugs([
      { id: "new", triage: {}, bugs: [bug("b2", "Withdraw reverts"), bug("b3", "Rounding")] },
      { id: "old", triage: { b1: "accepted", b9: "works-as-intended" }, bugs: [bug("b1", "Withdraw reverts"), bug("b9", "Rounding")] },
    ]);
    expect(open.map((b) => [b.bug.id, b.triage])).toEqual([["b2", "accepted"]]);
    expect(setAside.map((b) => [b.bug.id, b.triage])).toEqual([["b3", "works-as-intended"]]);
  });

  it("lets a newer decision win", () => {
    const { open } = appBugs([
      { id: "new", triage: { b2: "open" }, bugs: [bug("b2", "Withdraw reverts")] },
      { id: "old", triage: { b1: "works-as-intended" }, bugs: [bug("b1", "Withdraw reverts")] },
    ]);
    expect(open.map((b) => b.triage)).toEqual(["open"]);
  });
});
