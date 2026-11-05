import { describe, expect, it } from "vitest";
import { checkKey, closeGate, type ExploreBug, type ExploreCheck, type ExploreFlow } from "../src/index.js";

const flow = (name: string, tier: ExploreFlow["tier"] = "critical"): ExploreFlow => ({ name, tier, why: "" });
const check = (status: ExploreCheck["status"], name = "Deposit"): ExploreCheck => ({ id: "c", explorerId: "e", flow: name, name: "Shows a balance", variation: "happy", startPath: "/", path: [], assert: { kind: "shows", value: "Balance" }, status, evidence: "", signs: false, at: "" });
const bug = (status: ExploreBug["status"]) => ({ status }) as ExploreBug;

describe("closeGate", () => {
  it("holds a Critical flow with no verdict and no named gap", () => {
    expect(closeGate({ bugs: [], flows: [flow("Deposit")], checks: [], gaps: [] }).unsettled).toHaveLength(1);
  });

  it("doesn't take a check that couldn't be made as a verdict", () => {
    expect(closeGate({ bugs: [], flows: [flow("Deposit")], checks: [check("error")], gaps: [] }).unsettled).toHaveLength(1);
  });

  it("lets a check or a named gap settle a flow", () => {
    expect(closeGate({ bugs: [], flows: [flow("Deposit")], checks: [check("fail")], gaps: [] }).unsettled).toHaveLength(0);
    expect(closeGate({ bugs: [], flows: [flow("Deposit")], checks: [], gaps: [{ flow: "Deposit", what: "Withdraw", why: "No funds" }] }).unsettled).toHaveLength(0);
  });

  it("ignores flows that aren't Critical", () => {
    expect(closeGate({ bugs: [], flows: [flow("Docs", "supporting")], checks: [], gaps: [] }).unsettled).toHaveLength(0);
  });

  it("holds bugs nobody has settled", () => {
    const bugs = [bug("suspected"), bug("reproducing"), bug("confirmed"), bug("not-a-bug")];
    expect(closeGate({ bugs, flows: [], checks: [], gaps: [] }).unreviewed.map((b) => b.status)).toEqual(["suspected", "reproducing"]);
  });
});

describe("checkKey", () => {
  it("treats case and spacing as the same check", () => {
    expect(checkKey({ flow: "Deposit", name: "Shows  a balance", assert: { kind: "shows", value: "Balance" } })).toBe(checkKey({ flow: "deposit", name: "shows a balance", assert: { kind: "shows", value: "balance" } }));
  });
});
