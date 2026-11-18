import { describe, expect, it } from "vitest";
import { noteText, Suite, Test } from "@dappdrill/core";
import type { Made } from "../../src/make/maker.js";
import { makeEach, MAX_SUSPICIONS, MAX_UNMADE } from "../../src/make/tests.js";

const test = (id: string) => Test.parse({ id, name: id, goal: id, steps: [{ type: "action", by: "llm", do: "Go." }, { type: "check", by: "llm", claim: "It went." }] });
const made = (id: string, more: Partial<Made> = {}): Made => ({ test: test(id), proven: true, stands: "passed", notes: [], findings: [], repairs: [], dismissed: [], runs: [], draftUsd: 0, costUsd: 0, durationMs: 0, ...more });
const seen = (what: string, proven = false) => ({ what, expected: "It adds up.", saw: "It doesn't.", goal: `A user sees that ${what}.`, proven });
const goals = (...names: string[]) => names.map((goal) => ({ goal, startPath: "/", why: "money" }));
const empty = Suite.parse({});

describe("makeEach", () => {
  it("makes a test for each goal, then one for what looked wrong, and keeps that one only when it fails", async () => {
    const asked: { goal: string; suspicion?: string }[] = [];
    const { suite, attempts } = await makeEach({ goals: goals("deposit", "withdraw"), notes: ["Approve first."], problems: [seen("the fee is shown twice")] }, { suite: empty }, async ({ goal, suspicion }) => {
      asked.push({ goal, suspicion: suspicion?.what });
      if (goal === "deposit") return made("deposit", { findings: [seen("the history rounds down")], notes: ["Wait for the toast."] });
      if (suspicion?.what === "the fee is shown twice") return made("fee", { dismissed: ["One is the fee and one the total."] });
      if (suspicion) return made("history", { stands: "failed", findings: [seen("the history rounds down", true), seen("the list cuts the amount")] });
      return made(goal);
    });
    expect(asked).toEqual([
      { goal: "deposit", suspicion: undefined },
      { goal: "withdraw", suspicion: undefined },
      { goal: "A user sees that the fee is shown twice.", suspicion: "the fee is shown twice" },
      { goal: "A user sees that the history rounds down.", suspicion: "the history rounds down" },
    ]);
    expect(suite.tests.map((t) => t.id)).toEqual(["deposit", "withdraw", "history"]);
    expect(suite.notes).toEqual([{ text: "Approve first.", from: "look" }, { text: "Wait for the toast.", from: "maker" }]);
    expect(attempts.map((a) => a.kept)).toEqual([true, true, false, true]);
    expect(attempts[2]!.why).toBe("One is the fee and one the total.");
  });

  it("looks into a thing once, and into no more than a few", async () => {
    const many = [...["a", "A", "b"].map((what) => seen(what)), { ...seen("b in other words"), goal: seen("b").goal }, seen("c"), seen("d")];
    const into: string[] = [];
    await makeEach({ goals: goals("deposit"), notes: [], problems: many }, { suite: empty }, async ({ suspicion }) => {
      if (!suspicion) return made("deposit");
      into.push(suspicion.what);
      return made("x", { proven: false, test: undefined, why: "Couldn't be done." });
    });
    expect(into).toEqual(["a", "b", "c"]);
    expect(into).toHaveLength(MAX_SUSPICIONS);
  });

  it("keeps what a goal that wasn't kept learned, as less sure, and makes it sure when a kept test learns it again", async () => {
    const heard: string[][] = [];
    const { suite } = await makeEach({ goals: goals("long", "short", "close"), notes: [], problems: [] }, { suite: empty }, async ({ goal, suite }) => {
      heard.push(suite.notes.map(noteText));
      if (goal === "long") return made("long", { proven: false, test: undefined, why: "Not steady.", notes: ["The orders list is long.", "Trading needs enabling."] });
      if (goal === "short") return made("short", { notes: ["Trading needs enabling.", "Trading needs enabling."] });
      return made("close");
    });
    expect(heard[1]).toEqual(["The orders list is long. (learned while making a test that wasn't kept, so it may be wrong)", "Trading needs enabling. (learned while making a test that wasn't kept, so it may be wrong)"]);
    expect(suite.notes).toEqual([
      { text: "The orders list is long.", from: "unkept" },
      { text: "Trading needs enabling.", from: "maker" },
    ]);
    expect(suite.tests.map((t) => t.id)).toEqual(["short", "close"]);
  });

  it("makes so many side by side, and gives two tests that came to one id an id each", async () => {
    let running = 0;
    let most = 0;
    const started: string[] = [];
    const { suite, attempts } = await makeEach({ goals: goals("a", "b", "c", "d", "e"), notes: [], problems: [] }, { suite: empty, together: 2 }, async ({ goal }) => {
      started.push(goal);
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, goal === "a" ? 20 : 5));
      running--;
      return made(goal === "b" ? "a" : goal);
    });
    expect(most).toBe(2);
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
    expect(attempts.map((a) => a.goal)).toEqual(["a", "b", "c", "d", "e"]);
    expect(suite.tests.map((t) => t.id).sort()).toEqual(["a", "a-2", "c", "d", "e"]);
  });

  it("carries on with the next goal when a make breaks", async () => {
    const { suite, attempts } = await makeEach({ goals: goals("deposit", "withdraw"), notes: [], problems: [] }, { suite: empty }, async ({ goal }) => {
      if (goal === "deposit") throw new Error("the browser closed");
      return made(goal);
    });
    expect(suite.tests.map((t) => t.id)).toEqual(["withdraw"]);
    expect(attempts[0]).toMatchObject({ kept: false, why: "It broke on our side: the browser closed" });
  });

  it("starts no goal after one whose setup didn't finish, and says where it stopped", async () => {
    const stuck = { line: 1, sentence: "Connect the wallet.", reason: "The wallet has no funds there.", fix: "funds" as const };
    const asked: string[] = [];
    const out = await makeEach({ goals: goals("deposit", "withdraw", "claim"), notes: [], problems: [seen("the fee is shown twice")] }, { suite: empty }, async ({ goal }) => {
      asked.push(goal);
      return goal === "deposit" ? made(goal) : made(goal, { proven: false, test: undefined, why: "The setup didn't finish.", stuck });
    });
    expect(asked).toEqual(["deposit", "withdraw"]);
    expect(out.stuck).toEqual(stuck);
    expect(out.suite.tests.map((t) => t.id)).toEqual(["deposit"]);
    expect(out.attempts.map((a) => a.kept)).toEqual([true, false]);
  });

  it("doesn't try a goal that what stopped an earlier one would stop too, and keeps what stopped it as a note", async () => {
    const blocker = "Market buys expire unfilled: the markets are illiquid.";
    const asked: string[] = [];
    const judged: { goal: string; blockers: string[] }[] = [];
    const stoppedBy = async (goal: string, blockers: string[]) => {
      judged.push({ goal, blockers });
      return goal === "buy GOOGL" ? 0 : undefined;
    };
    const { suite, attempts } = await makeEach({ goals: goals("buy NVDA", "buy GOOGL", "read the history"), notes: [], problems: [] }, { suite: empty, stoppedBy }, async ({ goal }) => {
      asked.push(goal);
      if (goal === "buy NVDA") return made(goal, { proven: false, test: undefined, why: "The order expired.", blocker, ask: "Is there a liquid market on staging?", notes: ["Trading needs enabling."] });
      return made(goal);
    });
    expect(asked).toEqual(["buy NVDA", "read the history"]);
    expect(judged).toEqual([
      { goal: "buy GOOGL", blockers: [`In the way: ${blocker}`] },
      { goal: "read the history", blockers: [`In the way: ${blocker}`] },
    ]);
    expect(attempts[1]).toMatchObject({ goal: "buy GOOGL", kept: false, why: `Not tried: ${blocker}`, ask: "Is there a liquid market on staging?" });
    expect(attempts[1]!.made).toBeUndefined();
    expect(suite.notes).toEqual([
      { text: "Trading needs enabling.", from: "unkept" },
      { text: blocker, from: "unkept" },
    ]);
    expect(suite.tests.map((t) => t.id)).toEqual(["read the history"]);
  });

  it("doesn't try a goal that would only fail again on a fault a kept test already fails on", async () => {
    const cancel = seen("cancelling leaves the order Open", true);
    const judged: string[][] = [];
    const stoppedBy = async (goal: string, stoppers: string[]) => {
      judged.push(stoppers);
      return goal === "edit an order" ? 0 : undefined;
    };
    const asked: string[] = [];
    const { suite, attempts } = await makeEach({ goals: goals("cancel an order", "edit an order", "read the history"), notes: [], problems: [] }, { suite: empty, stoppedBy }, async ({ goal }) => {
      asked.push(goal);
      if (goal === "cancel an order") return made("cancel", { stands: "failed", findings: [cancel, seen("the fee rounds", false)] });
      return made(goal);
    });
    expect(asked).toEqual(["cancel an order", "read the history", "A user sees that the fee rounds."]);
    expect(judged[0]).toEqual(["A fault of the app, which the test “cancel” fails on every time: cancelling leaves the order Open. It doesn't."]);
    expect(attempts[1]).toMatchObject({ goal: "edit an order", kept: false, why: "Not tried: it would fail on “cancelling leaves the order Open”, which the test “cancel” already fails on." });
    expect(attempts[1]!.ask).toBeUndefined();
    // The fee rounding was only suspected, so its own test was made; it passed, so there was nothing to keep.
    expect(suite.tests.map((t) => t.id)).toEqual(["cancel", "read the history"]);
  });

  it("stops after so many goals in a row couldn't be made while none was kept, and not once one was", async () => {
    const no = (goal: string) => made(goal, { proven: false, test: undefined, why: "The order expired." });
    const asked: string[] = [];
    const none = await makeEach({ goals: goals("a", "b", "c", "d", "e"), notes: [], problems: [seen("the fee is shown twice")] }, { suite: empty, together: 2 }, async ({ goal }) => (asked.push(goal), no(goal)));
    expect(asked).toEqual(["a", "b", "c", "d"]);
    expect(MAX_UNMADE).toBe(3);
    // Two side by side: the third that ended stopped any more from starting, and the one beside it was let finish.
    expect(none.stopped).toMatch(/^Stopped because the first goals tried couldn't be made/);
    expect(none.attempts).toHaveLength(4);

    // A goal not tried doesn't count, and one kept turns the cut-off off.
    const blocker = "Nobody sells.";
    const some = await makeEach({ goals: goals("a", "b", "c", "d", "e", "f"), notes: [], problems: [] }, { suite: empty, stoppedBy: async (goal) => (goal === "b" || goal === "c" ? 0 : undefined) }, async ({ goal }) =>
      goal === "a" ? made(goal, { proven: false, test: undefined, blocker }) : goal === "e" ? made(goal) : no(goal),
    );
    expect(some.stopped).toBeUndefined();
    expect(some.attempts.map((a) => [a.goal, a.made ? "tried" : "skipped"])).toEqual([["a", "tried"], ["b", "skipped"], ["c", "skipped"], ["d", "tried"], ["e", "tried"], ["f", "tried"]]);
  });

  it("waits for a goal still being made before stopping, and goes on when it is kept", async () => {
    const asked: string[] = [];
    const out = await makeEach({ goals: goals("slow", "b", "c", "d", "e"), notes: [], problems: [] }, { suite: empty, together: 2 }, async ({ goal }) => {
      asked.push(goal);
      if (goal !== "slow") return made(goal, { proven: false, test: undefined, why: "The order expired." });
      await new Promise((r) => setTimeout(r, 20));
      return made(goal);
    });
    // b, c and d ended without a test while slow was still being made; slow was kept, so e was tried.
    expect(asked).toEqual(["slow", "b", "c", "d", "e"]);
    expect(out.stopped).toBeUndefined();
    expect(out.suite.tests.map((t) => t.id)).toEqual(["slow"]);
  });

  it("tries the goal when it can't be told whether it is stopped", async () => {
    const asked: string[] = [];
    await makeEach({ goals: goals("a", "b"), notes: [], problems: [] }, { suite: empty, stoppedBy: async () => Promise.reject(new Error("overloaded")) }, async ({ goal }) => {
      asked.push(goal);
      return goal === "a" ? made(goal, { proven: false, test: undefined, blocker: "The service is down." }) : made(goal);
    });
    expect(asked).toEqual(["a", "b"]);
  });
});
