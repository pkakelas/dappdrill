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
      { id: "new", triage: {}, titles: null, bugs: [bug("b2", "Withdraw reverts")] },
      { id: "old", triage: {}, titles: null, bugs: [bug("b1", "withdraw reverts"), bug("b0", "Old bug")] },
    ]);
    expect(open.map((b) => [b.passId, b.bug.id])).toEqual([
      ["new", "b2"],
      ["old", "b0"],
    ]);
  });

  it("keeps a dismissal when the bug is found again", () => {
    const { open, setAside } = appBugs([
      { id: "new", triage: {}, titles: null, bugs: [bug("b2", "Withdraw reverts"), bug("b3", "Rounding")] },
      { id: "old", triage: { b1: "open", b9: "dismissed" }, titles: null, bugs: [bug("b1", "Withdraw reverts"), bug("b9", "Rounding")] },
    ]);
    expect(open.map((b) => [b.bug.id, b.triage])).toEqual([["b2", "open"]]);
    expect(setAside.map((b) => [b.bug.id, b.triage])).toEqual([["b3", "dismissed"]]);
  });

  it("lets a newer decision win", () => {
    const { open } = appBugs([
      { id: "new", triage: { b2: "open" }, titles: null, bugs: [bug("b2", "Withdraw reverts")] },
      { id: "old", triage: { b1: "dismissed" }, titles: null, bugs: [bug("b1", "Withdraw reverts")] },
    ]);
    expect(open.map((b) => b.triage)).toEqual(["open"]);
  });

  it("sets a fixed bug aside, with the test that passed", () => {
    const test = { id: "t1", appId: "a", settled: "pass" as const };
    const { open, setAside } = appBugs([{ id: "p", triage: { b1: "fixed" }, titles: null, bugs: [bug("b1", "Withdraw reverts"), bug("b2", "Rounding")] }], new Map([["b1", test]]));
    expect(open.map((b) => b.bug.id)).toEqual(["b2"]);
    expect(setAside.map((b) => [b.bug.id, b.triage, b.test])).toEqual([["b1", "fixed", test]]);
  });

  it("opens a fixed bug again when a later exploration finds it", () => {
    const { open, setAside } = appBugs([
      { id: "new", triage: {}, titles: null, bugs: [bug("b2", "Withdraw reverts")] },
      { id: "old", triage: { b1: "fixed" }, titles: null, bugs: [bug("b1", "Withdraw reverts")] },
    ]);
    expect(open.map((b) => [b.bug.id, b.triage])).toEqual([["b2", "open"]]);
    expect(setAside).toEqual([]);
  });

  it("keeps the latest exploration's reports that didn't hold up apart from what a person dismissed", () => {
    const { open, setAside } = appBugs([{ id: "p", triage: { b2: "dismissed" }, titles: null, bugs: [bug("b1", "Wrong guess", "not-a-bug"), bug("b2", "Rounding")] }]);
    expect(open).toEqual([]);
    expect(setAside.map((b) => [b.bug.id, b.triage])).toEqual([
      ["b1", "open"],
      ["b2", "dismissed"],
    ]);
  });
});
