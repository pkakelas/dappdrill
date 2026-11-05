import type { ExploreBug, ExploreCheck, ExploreFlow, ExploreState } from "@dappdrill/core";
import { describe, expect, it } from "vitest";
import { settleDecision } from "../../src/explore/bugs.js";
import { agrees } from "../../src/explore/checks.js";
import { areaBudgetMs } from "../../src/explore/plan.js";
import { enforceRule, extractChecks } from "../../src/explore/promote.js";

const check = (id: string, over: Partial<ExploreCheck> = {}): ExploreCheck => ({ id, explorerId: "e", flow: "Deposit", name: "Shows a balance", variation: "happy", startPath: "/", path: ["Open"], assert: { kind: "shows", value: "Balance" }, status: "pass", evidence: "", signs: false, at: "", ...over });
const flow = (tier: ExploreFlow["tier"]): ExploreFlow => ({ name: "Deposit", tier, why: "" });
const state = (over: Partial<ExploreState>) => ({ flows: [], checks: [], bugs: [], ...over }) as ExploreState;
const pick = (name: string, checkIds: string[], over = {}) => ({ test: { name, goal: "", expected: "", startPath: "/", steps: [] }, checkIds, why: "", canFailOnItsOwn: true, provesOutcome: true, ...over });

describe("agrees", () => {
  it("allows the rounding a page shows", () => {
    expect(agrees("1.23", "1.2345")).toBe(true);
    expect(agrees("1,234.5 USDC", "1234.51")).toBe(true);
  });

  it("catches a number that's really different", () => {
    expect(agrees("1.23", "1.25")).toBe(false);
    expect(agrees("100", "101.5")).toBe(false);
  });
});

describe("extractChecks", () => {
  it("merges repeats and keeps the failure", () => {
    const s = state({ checks: [check("a"), check("b", { status: "fail", evidence: "No balance" })] });
    extractChecks(s, new Set());
    expect(s.checks.map((c) => c.id)).toEqual(["b"]);
  });

  it("files a failed check nobody filed, and leaves one that was", () => {
    const s = state({ checks: [check("a", { status: "fail" }), check("b", { status: "fail", name: "Other" })] });
    extractChecks(s, new Set(["a"]));
    expect(s.bugs.map((b) => b.name)).toEqual(["Other"]);
    expect(s.bugs[0]).toMatchObject({ source: "check", status: "suspected" });
  });

  it("moves a flow that signed up to Critical", () => {
    const s = state({ flows: [flow("important")], checks: [check("a", { signs: true })] });
    extractChecks(s, new Set());
    expect(s.flows[0]!.tier).toBe("critical");
  });
});

describe("enforceRule", () => {
  const checks = [check("a"), check("b", { status: "fail" })];

  it("saves nothing for a Supporting flow", () => {
    expect(enforceRule(flow("supporting"), { candidates: [pick("One", ["a"])] } as never, checks, [])).toEqual([]);
  });

  it("needs both parts of the rule and a check that passed", () => {
    const picks = [pick("Shallow", ["a"], { provesOutcome: false }), pick("Tied", ["a"], { canFailOnItsOwn: false }), pick("Failing", ["b"]), pick("Good", ["a", "b"])];
    const out = enforceRule(flow("critical"), { candidates: picks } as never, checks, []);
    expect(out.map((c) => c.draft.name)).toEqual(["Good"]);
    expect(out[0]!.checkIds).toEqual(["a"]);
  });

  it("won't save a name twice, or past the tier's limit", () => {
    const existing = [{ id: "t", name: "good", goal: "", flow: "Deposit" }, { id: "u", name: "x", goal: "", flow: "Deposit" }, { id: "v", name: "y", goal: "", flow: "Deposit" }];
    const out = enforceRule(flow("important"), { candidates: [pick("Good", ["a"]), pick("One", ["a"]), pick("Two", ["a"])] } as never, checks, existing);
    expect(out.map((c) => c.draft.name)).toEqual(["One"]);
  });
});

describe("settleDecision", () => {
  const bug = (network: string[] = []) => ({ evidence: { network } }) as ExploreBug;

  it("doesn't confirm on a failed request alone", () => {
    expect(settleDecision(bug(["rpc.example"]), "confirmed", undefined, [])).toBe("reproduce");
    expect(settleDecision(bug(), "confirmed", undefined, [])).toBe("confirmed");
  });

  it("only calls something a duplicate of a bug that's settled", () => {
    expect(settleDecision(bug(), "duplicate", "bug_1", [])).toBe("reproduce");
    expect(settleDecision(bug(), "duplicate", "bug_1", [{ id: "bug_1" } as ExploreBug])).toBe("duplicate");
  });
});

describe("areaBudgetMs", () => {
  const areas = [{ tier: "critical" }, { tier: "critical" }, { tier: "important" }, { tier: "supporting" }] as const;
  const hour = 3_600_000;

  it("gives Critical areas the larger share, split between them", () => {
    expect(areaBudgetMs(areas[0], [...areas], hour, 1)).toBeCloseTo(hour * 0.35);
    expect(areaBudgetMs(areas[2], [...areas], hour, 1)).toBeCloseTo(hour * 0.2);
  });

  it("hands a missing tier's time to the others", () => {
    expect(areaBudgetMs(areas[0], [areas[0]], hour, 1)).toBeCloseTo(hour);
  });
});
