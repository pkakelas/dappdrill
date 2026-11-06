import type { ExploreBug, ExploreFeature, ExploreState, ExploreSuggestion } from "@dappdrill/core";
import { describe, expect, it } from "vitest";
import { matchReport, settleDecision } from "../../src/explore/bugs.js";
import { agrees } from "../../src/explore/checks.js";
import { MAX_CRITICAL, settleFeatures, type Found } from "../../src/explore/look.js";
import { conditionsFor, hardEvidence } from "../../src/explore/prove.js";
import { assign } from "../../src/explore/recorded.js";
import { firstJobs, MAX_ROUNDS, nextRound } from "../../src/explore/run.js";

const feature = (name: string, tier: ExploreFeature["tier"] = "critical"): ExploreFeature => ({ name, tier, why: "", startPath: "/", brief: "" });
const draft = (name: string) => ({ name, goal: "", expected: "", startPath: "/", steps: ["Do it"] });
const suggestion = (over: Partial<ExploreSuggestion> = {}): ExploreSuggestion => ({ id: "s", feature: "Deposit", tier: "critical", draft: draft("Deposit"), status: "suggested", conditions: [], ...over });
const state = (over: Partial<ExploreState> = {}) => ({ suggested: [], bugs: [], checks: [], ...over }) as unknown as ExploreState;
const outcome = (result: object, steps: object[] = []) => ({ result: { walletRequests: [], signingReviews: [], ...result }, steps }) as never;
const forks = { chains: { configs: () => [{ mode: "fork" }] } } as never;
const live = { chains: { configs: () => [{ mode: "live" }] } } as never;

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

describe("settleFeatures", () => {
  const found = (features: Found["features"]): Found => ({ summary: "", pages: [], features });
  const f = (name: string, tier: ExploreFeature["tier"], tests = 3) => ({ ...feature(name, tier), tests: Array.from({ length: tests }, (_, i) => draft(`${name} ${i}`)) });

  it("keeps a short Critical list and moves the rest to Important", () => {
    const out = settleFeatures(found(["A", "B", "C", "D", "E"].map((n) => f(n, "critical"))));
    expect(out.features.map((x) => x.tier)).toEqual([...Array(MAX_CRITICAL).fill("critical"), "important"]);
    expect(out.features.at(-1)!.tests).toHaveLength(2);
  });

  it("writes no tests for supporting pages, and drops a feature named twice", () => {
    const out = settleFeatures(found([f("Docs", "supporting"), f("docs", "supporting")]));
    expect(out.features).toHaveLength(1);
    expect(out.features[0]!.tests).toEqual([]);
  });
});

describe("matchReport", () => {
  const bugs = [{ id: "bug_1" }];

  it("files the first bug straight away", () => {
    expect(matchReport([], undefined)).toBe("new");
  });

  it("asks once something is filed", () => {
    expect(matchReport(bugs, undefined)).toBe("ask");
  });

  it("takes the explorer's answer, and files a bug whose match doesn't exist", () => {
    expect(matchReport(bugs, "bug_1")).toBe("bug_1");
    expect(matchReport(bugs, "new")).toBe("new");
    expect(matchReport(bugs, "bug_9")).toBe("new");
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
    expect(settleDecision(bug(), "duplicate", "bug_1", [{ id: "bug_1" }])).toBe("duplicate");
  });
});

describe("hardEvidence", () => {
  it("takes a revert as the app's fault", () => {
    expect(hardEvidence(outcome({ walletRequests: [{ kind: "sign", outcome: "errored", error: "execution reverted: paused" }] }))).toMatch(/reverted/);
  });

  it("leaves a test that just didn't get there as a draft", () => {
    expect(hardEvidence(outcome({ failure: "The button wasn't there" }))).toBeUndefined();
    expect(hardEvidence(outcome({ walletRequests: [{ kind: "sign", outcome: "rejected" }] }))).toBeUndefined();
    expect(hardEvidence(outcome({ signingReviews: [{ verdict: "dangerous", title: "Unlimited approval", summary: "" }] }))).toBeUndefined();
  });
});

describe("conditionsFor", () => {
  const wallet = (respond = "approve") => ({ text: "In the wallet", actions: [{ kind: "wallet", respond }] });
  const request = (method: string, outcome = "approved") => ({ kind: "sign", method, outcome });
  const sent = outcome({ walletRequests: [request("eth_sendTransaction")] }, [wallet()]);

  it("gives conditions only to Critical tests that send a transaction", () => {
    expect(conditionsFor("critical", sent, forks).length).toBeGreaterThan(0);
    expect(conditionsFor("important", sent, forks)).toEqual([]);
    expect(conditionsFor("critical", outcome({}), forks)).toEqual([]);
  });

  it("doesn't count the setup's transaction, a signed message or a rejection", () => {
    const setupOnly = outcome({ walletRequests: [request("eth_sendTransaction")] }, [{ text: "Type too much" }]);
    const message = outcome({ walletRequests: [request("eth_sendTransaction"), request("personal_sign")] }, [wallet()]);
    const rejected = outcome({ walletRequests: [request("eth_sendTransaction"), request("eth_sendTransaction", "rejected")] }, [wallet("reject")]);
    for (const o of [setupOnly, message, rejected]) expect(conditionsFor("critical", o, forks)).toEqual([]);
  });

  it("leaves out what needs a fork on a live chain", () => {
    expect(conditionsFor("critical", sent, live).length).toBeLessThan(conditionsFor("critical", sent, forks).length);
  });
});

describe("assign", () => {
  const click = (text: string) => ({ kind: "click", target: { text } }) as never;
  const actions = [click("Connect"), click("Oops"), click("Deposit")];

  it("gives each step its actions and leaves a step without any to the model", () => {
    const steps = assign(["Connect the wallet", "Enter 5", "Deposit"], actions, [1, 0, 3]);
    expect(steps?.map((s) => s.actions?.length)).toEqual([1, undefined, 1]);
  });

  it("refuses an answer that doesn't fit", () => {
    expect(assign(["A", "B"], actions, [1, 2])).toBeUndefined();
    expect(assign(["A", "B"], actions, [2, 1, 2])).toBeUndefined();
    expect(assign(["A", "B"], actions, [1, 2, 3])).toBeUndefined();
    expect(assign(["A", "B"], actions, [0, 0, 0])).toBeUndefined();
  });
});

describe("firstJobs", () => {
  it("puts Critical first and gives all supporting pages one explorer", () => {
    const jobs = firstJobs([feature("Docs", "supporting"), feature("Balances", "important"), feature("Terms", "supporting"), feature("Deposit")]);
    expect(jobs.map((j) => j.feature.name)).toEqual(["Deposit", "Balances", "Other pages"]);
    expect(jobs.at(-1)!.feature.brief).toContain("Terms");
  });
});

describe("nextRound", () => {
  const job = (tier: ExploreFeature["tier"] = "critical", round = 1) => ({ feature: feature("Deposit", tier), round });

  it("goes again while a suggested test is untried", () => {
    expect(nextRound(state({ suggested: [suggestion()] }), job("important"), 0)?.round).toBe(2);
  });

  it("goes again on a Critical feature that kept finding things, and on no other", () => {
    expect(nextRound(state(), job(), 1)?.round).toBe(2);
    expect(nextRound(state(), job("important"), 1)).toBeUndefined();
  });

  it("stops when a round found nothing, at the last round, and for supporting pages", () => {
    expect(nextRound(state(), job(), 0)).toBeUndefined();
    expect(nextRound(state({ suggested: [suggestion()] }), job("critical", MAX_ROUNDS), 3)).toBeUndefined();
    expect(nextRound(state({ suggested: [suggestion({ feature: "Deposit", tier: "supporting" })] }), job("supporting"), 3)).toBeUndefined();
  });

  it("doesn't retry a test that was tried and didn't work", () => {
    expect(nextRound(state({ suggested: [suggestion({ note: "It looked like a bug to an explorer, but a second look disagreed." })] }), job("important"), 0)).toBeUndefined();
  });
});
