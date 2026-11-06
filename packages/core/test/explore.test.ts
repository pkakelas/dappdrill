import { describe, expect, it } from "vitest";
import { checkFate, checkKey, closeGate, openSuggestion, type ExploreBug, type ExploreCheck, type ExploreFeature, type SuggestionStatus } from "../src/index.js";

const feature = (name: string, tier: ExploreFeature["tier"] = "critical"): ExploreFeature => ({ name, tier, why: "", startPath: "/", brief: "" });
const check = (status: ExploreCheck["status"], name = "Deposit"): ExploreCheck => ({ id: "c", explorerId: "e", feature: name, name: "Shows a balance", variation: "happy", startPath: "/", path: [], assert: { kind: "shows", value: "Balance" }, status, evidence: "", signs: false, at: "" });
const bug = (status: ExploreBug["status"]) => ({ status }) as ExploreBug;

describe("closeGate", () => {
  it("holds a Critical feature with no verdict and no named gap", () => {
    expect(closeGate({ bugs: [], features: [feature("Deposit")], checks: [], gaps: [] }).unsettled).toHaveLength(1);
  });

  it("doesn't take a check that couldn't be made as a verdict", () => {
    expect(closeGate({ bugs: [], features: [feature("Deposit")], checks: [check("error")], gaps: [] }).unsettled).toHaveLength(1);
  });

  it("lets a check or a named gap settle a feature", () => {
    expect(closeGate({ bugs: [], features: [feature("Deposit")], checks: [check("fail")], gaps: [] }).unsettled).toHaveLength(0);
    expect(closeGate({ bugs: [], features: [feature("Deposit")], checks: [], gaps: [{ feature: "Deposit", what: "Withdraw", why: "No funds" }] }).unsettled).toHaveLength(0);
  });

  it("ignores features that aren't Critical", () => {
    expect(closeGate({ bugs: [], features: [feature("Docs", "supporting")], checks: [], gaps: [] }).unsettled).toHaveLength(0);
  });

  it("holds bugs nobody has settled", () => {
    const bugs = [bug("suspected"), bug("reproducing"), bug("confirmed"), bug("not-a-bug")];
    expect(closeGate({ bugs, features: [], checks: [], gaps: [] }).unreviewed.map((b) => b.status)).toEqual(["suspected", "reproducing"]);
  });
});

describe("checkKey", () => {
  it("treats case and spacing as the same check", () => {
    expect(checkKey({ feature: "Deposit", name: "Shows  a balance", assert: { kind: "shows", value: "Balance" } })).toBe(checkKey({ feature: "deposit", name: "shows a balance", assert: { kind: "shows", value: "balance" } }));
  });
});

describe("checkFate", () => {
  const fate = (status: SuggestionStatus) => checkFate({ suggestionId: "s" }, [{ id: "s", status }]);

  it("says what a check's path became", () => {
    expect(fate("proved")).toBe("test");
    expect(fate("draft")).toBe("test");
    expect(fate("bug")).toBe("bug");
    expect(fate("proving")).toBe("suggested");
    expect(fate("dropped")).toBe("none");
    expect(checkFate({}, [])).toBe("none");
  });
});

describe("openSuggestion", () => {
  it("is still on offer until it is saved, written off or left out", () => {
    const open = (["suggested", "trying", "worked", "proving", "proved", "draft", "bug", "dropped"] as const).filter((status) => openSuggestion({ status }));
    expect(open).toEqual(["suggested", "trying", "worked", "proving"]);
  });
});
