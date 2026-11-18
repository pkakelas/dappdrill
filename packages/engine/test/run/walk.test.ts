/**
 * A run with no model, on the test dApp and a local Anvil: what is code is done, and a line that isn't
 * code, or whose recording no longer fits the page, is Couldn't verify and can be repaired. Asking for
 * a model throws here, so a run that reached for one would say so.
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DrillTarget, Suite, type BrowserAction } from "@dappdrill/core";
import { createLlm } from "../../src/agent/index.js";
import { repairSuite, runSuite } from "../../src/api.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "../runtime/fixture.js";

vi.mock("../../src/agent/index.js", async (original) => ({
  ...(await original<typeof import("../../src/agent/index.js")>()),
  createLlm: vi.fn(() => {
    throw new Error("A run asked for a model.");
  }),
}));

let fx: Fixture;
let artifactsDir: string;

beforeAll(async () => {
  fx = await startFixture();
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-walk-"));
}, 60_000);

afterAll(async () => {
  await fx?.close();
});

const connect: BrowserAction[] = [
  // A prompt this app doesn't show: the recording goes past it.
  { kind: "click", target: { role: "button", name: "Accept the terms" }, optional: true },
  { kind: "click", target: { role: "button", name: "Connect wallet" } },
  { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true } },
];
const connected = { type: "action", by: "code", do: "Connect the wallet.", run: connect };
const isConnected = { type: "check", by: "code", claim: "The wallet is connected.", expect: { kind: "all", of: [{ kind: "shows", text: "via MetaMask" }, { kind: "button", name: "Connected", is: "enabled" }, { kind: "not-signed" }] } };

const input = (suite: object) => ({ target: DrillTarget.parse({ url: fx.pageUrl(), chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS, account: "kept" }), suite: Suite.parse(suite), artifactsDir });
const run = (suite: object) => runSuite(input(suite));
const test = (id: string, steps: object[]) => ({ id, name: id, goal: "Connect and deposit.", steps });

describe("a run with no model", () => {
  it("does what is code: a recording with an optional step, and checks", async () => {
    const out = await run({ tests: [test("connects", [connected, isConnected, { type: "check", by: "code", claim: "Nothing is deposited yet.", expect: { kind: "hides", text: "Deposited" } }])] });
    const [result] = out.tests;
    expect(result).toMatchObject({ outcome: "passed", repairable: false, costUsd: 0 });
    expect(result!.steps.map((s) => [s.status, s.by])).toEqual([["pass", "code"], ["pass", "code"], ["pass", "code"]]);
    expect(out.costUsd).toBe(0);
  }, 120_000);

  it("stops at a line that isn't code yet, and says the test can be repaired", async () => {
    const out = await run({
      tests: [
        test("unrecorded", [connected, { type: "action", by: "code", do: "Type 5 into Amount." }, isConnected, { type: "action", by: "code", do: "Click Deposit." }]),
        test("old", [connected, { type: "action", by: "llm", do: "Type 5 into Amount." }, isConnected]),
        test("sentence", [connected, { type: "check", by: "llm", claim: "The page greets the user." }, isConnected, connected]),
      ],
    });
    for (const result of out.tests) expect(result).toMatchObject({ outcome: "unverified", repairable: true, costUsd: 0 });
    const [unrecorded, old, sentence] = out.tests;
    expect(unrecorded!.steps.map((s) => s.status)).toEqual(["pass", "unsure", "skipped", "skipped"]);
    expect(unrecorded!.steps[1]).toMatchObject({ by: "code", note: "This line isn't written as code yet." });
    expect(unrecorded!.reason).toContain("This line isn't written as code yet.");
    expect(old!.steps.map((s) => s.status)).toEqual(["pass", "unsure", "skipped"]);
    expect(old!.steps[1]!.note).toBe("This line isn't written as code yet.");
    // Nothing after a check with no code is looked at either: it was written to follow it.
    expect(sentence!.steps.map((s) => s.status)).toEqual(["pass", "unsure", "skipped", "skipped"]);
    expect(sentence!.steps[1]).toMatchObject({ by: "llm", note: "This line isn't written as code yet." });
  }, 180_000);

  it("stops at a recording that no longer fits the page, and says the test can be repaired", async () => {
    const gone: BrowserAction[] = [{ kind: "click", target: { role: "button", name: "Withdraw everything" } }];
    const out = await run({ tests: [test("stale", [connected, { type: "action", by: "code", do: "Withdraw everything.", run: gone }, isConnected])] });
    const [result] = out.tests;
    expect(result).toMatchObject({ outcome: "unverified", repairable: true, costUsd: 0 });
    expect(result!.steps.map((s) => s.status)).toEqual(["pass", "unsure", "skipped"]);
    expect(result!.steps[1]!.by).toBe("code");
    expect(result!.steps[1]!.note).toMatch(/^The page isn't as recorded: .*Could not find role=button name="Withdraw everything"/);
    expect(result!.steps[1]!.redone).toBeUndefined();
  }, 180_000);

  it("fails on a check that fails, which is nothing to repair", async () => {
    const out = await run({ tests: [test("wrong", [connected, { type: "check", by: "code", claim: "A deposit is shown.", expect: { kind: "shows", text: "Deposited 5 TUSD", wait: 0 } }, { type: "action", by: "code", do: "Click Deposit." }])] });
    expect(out.tests[0]).toMatchObject({ outcome: "failed", repairable: false, rerun: true });
    expect(out.tests[0]!.steps.map((s) => s.status)).toEqual(["pass", "fail", "skipped"]);
  }, 180_000);

  it("starts no test when the setup has a line that isn't code, and says the setup can be repaired", async () => {
    const out = await run({ setup: { startPath: "/", steps: [connected, { type: "action", by: "code", do: "Dismiss the tour." }] }, tests: [test("after", [connected, isConnected])] });
    expect(out.setup!.map((s) => s.status)).toEqual(["pass", "unsure"]);
    expect(out.setup![1]!.note).toBe("This line isn't written as code yet.");
    expect(out.tests[0]).toMatchObject({ outcome: "unverified", repairable: true, steps: [] });
  }, 120_000);

  // Last, so that it speaks for every run above.
  it("never asked for a model, where a repair of the same line does", async () => {
    expect(createLlm).not.toHaveBeenCalled();
    await repairSuite(input({ tests: [test("unrecorded", [connected, { type: "action", by: "code", do: "Type 5 into Amount." }, isConnected])] })).catch(() => undefined);
    expect(createLlm).toHaveBeenCalled();
  }, 120_000);
});
