/**
 * A clean start for each test: a new paid account, or the reset on a kept one. The chain is a real
 * Anvil; the walk through a setup, a reset or a test is stood in for, since it has tests of its own.
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DrillTarget, LineResult, Suite, Test, type TestResult } from "@dappdrill/core";
import type { Env } from "../../src/run/env.js";
import { openSuite, runSuite } from "../../src/run/suite.js";
import { runSetup, runTest } from "../../src/run/test.js";
import { TOKEN_ABI } from "./contracts.js";
import { ACCOUNTS, CHAIN_ID, DEPLOYER_KEY, startFixture, type Fixture } from "./fixture.js";

vi.mock("../../src/run/test.js", async (original) => ({ ...(await original<typeof import("../../src/run/test.js")>()), runSetup: vi.fn(), runTest: vi.fn() }));
const setupOrReset = vi.mocked(runSetup);
const ran = vi.mocked(runTest);

let fx: Fixture;
let pub: PublicClient;
let artifactsDir: string;
const deployer = privateKeyToAccount(DEPLOYER_KEY);

const pass = LineResult.parse({ status: "pass", by: "code" });
const action = (text: string) => ({ type: "action" as const, by: "llm" as const, do: text });
const test = (id: string) => Test.parse({ id, name: id, goal: id, steps: [action("Go."), { type: "check", by: "llm", claim: "It went." }] });
const result = (testId: string, more: Partial<TestResult> = {}): TestResult => ({ testId, outcome: "passed", steps: [], values: {}, cleanup: [], reset: [], repairable: false, signingReviews: [], rerun: false, durationMs: 1, costUsd: 0, ...more });
const setup = { startPath: "/", steps: [action("Connect the wallet.")] };
const reset = { startPath: "/orders", steps: [action("Open the orders."), action("Cancel every open order.")] };
const target = (more: Partial<DrillTarget>) => DrillTarget.parse({ url: fx.siteUrl, chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], ...more });
const address = (env: Env) => privateKeyToAccount(env.target.accounts!.A as Hex).address;
const coin = (who: Hex) => pub.getBalance({ address: who });
const tokens = (who: Hex) => pub.readContract({ address: fx.token, abi: TOKEN_ABI, functionName: "balanceOf", args: [who] });
/** A key that holds the chain's coin and so many test tokens, to pay new accounts from. */
async function payer(holds: string): Promise<Hex> {
  const key = generatePrivateKey();
  const wallet = createWalletClient({ account: deployer, transport: http(fx.rpcUrl) });
  const sent = await wallet.sendTransaction({ to: privateKeyToAccount(key).address, value: parseEther("10"), chain: null });
  await pub.waitForTransactionReceipt({ hash: sent, pollingInterval: 100 });
  const minted = await wallet.writeContract({ abi: TOKEN_ABI, address: fx.token, functionName: "mint", args: [privateKeyToAccount(key).address, parseUnits(holds, 6)], chain: null });
  await pub.waitForTransactionReceipt({ hash: minted, pollingInterval: 100 });
  return key;
}

beforeAll(async () => {
  fx = await startFixture();
  pub = createPublicClient({ transport: http(fx.rpcUrl) });
}, 60_000);

afterAll(async () => {
  await fx?.close();
});

beforeEach(async () => {
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-suite-"));
  setupOrReset.mockReset();
  ran.mockReset();
  // A setup or a reset that goes through: every line passes and the browser's state is saved.
  setupOrReset.mockImplementation(async (_env, lines, opts) => ({ steps: lines.steps.map(() => pass), storageState: opts.saveTo }));
  ran.mockImplementation(async (_env, t) => result(t.id));
});

describe("new accounts", () => {
  const fund = [{ chainId: CHAIN_ID, amount: "1" }, { chainId: CHAIN_ID, token: "", amount: "25", symbol: "TUSD" }];
  beforeAll(() => {
    fund[1]!.token = fx.token;
  });

  it("gives every start a wallet of its own, paid before its setup, and hands the one made at open to the first caller", async () => {
    const held: bigint[] = [];
    setupOrReset.mockImplementation(async (env, lines, opts) => {
      held.push(await tokens(address(env)));
      return { steps: lines.steps.map(() => pass), storageState: opts.saveTo };
    });
    const open = await openSuite({ target: target({ account: "new", accounts: ACCOUNTS, fundedKey: await payer("100"), fund }), suite: Suite.parse({ setup }), artifactsDir }, () => {}, { byModel: true });
    try {
      expect(open.stuck).toBeUndefined();
      expect(setupOrReset).toHaveBeenCalledTimes(1);
      const first = await open.fresh();
      expect(setupOrReset).toHaveBeenCalledTimes(1);
      const second = await open.fresh();
      expect(setupOrReset).toHaveBeenCalledTimes(2);

      expect(first.env).toBe(open.env);
      expect(second.env).not.toBe(open.env);
      expect(second.env.chains).toBe(open.env.chains);
      const [a, b] = [address(first.env), address(second.env)];
      expect(new Set([a, b, privateKeyToAccount(ACCOUNTS.A).address]).size).toBe(3);
      for (const who of [a, b]) {
        expect(await coin(who)).toBe(parseEther("1"));
        expect(await tokens(who)).toBe(parseUnits("25", 6));
      }
      expect(held).toEqual([parseUnits("25", 6), parseUnits("25", 6)]);

      // Each start has its own browser state; the suite's own opts have none.
      expect(first.opts.storageState).toBe(path.join(artifactsDir, "setup-state.json"));
      expect(second.opts.storageState).toBe(path.join(artifactsDir, "setup-state-2.json"));
      expect(setupOrReset.mock.calls.map((c) => c[2].as?.id)).toEqual([undefined, "setup-2"]);
      expect(open.opts.storageState).toBeUndefined();
      expect([open.opts.byModel, first.opts.byModel, second.opts.byModel]).toEqual([true, true, true]);
      expect(first.setup).toEqual([pass]);

      // Closing a start leaves the chains open for the others.
      await second.env.close();
      expect(await open.env.chains.request(CHAIN_ID, "eth_chainId", [])).toBe("0x7a69");
    } finally {
      await open.close();
    }
  }, 60_000);

  it("leaves the new accounts empty when there is no key to pay them", async () => {
    const open = await openSuite({ target: target({ account: "new", fund }), suite: Suite.parse({}), artifactsDir });
    try {
      const start = await open.fresh();
      expect(start.why).toBeUndefined();
      expect(await coin(address(start.env))).toBe(0n);
      expect(setupOrReset).not.toHaveBeenCalled();
    } finally {
      await open.close();
    }
  }, 30_000);

  it("runs each test, and a failed test again, on an account of its own", async () => {
    ran.mockImplementationOnce(async (_env, t) => result(t.id, { outcome: "failed", reason: "“It went.”: it didn't" }));
    const out = await runSuite({ target: target({ account: "new", fundedKey: await payer("100"), fund }), suite: Suite.parse({ setup, tests: [test("deposit"), test("withdraw")] }), artifactsDir });
    expect(out.tests.map((t) => [t.testId, t.outcome, t.rerun, t.reason])).toEqual([
      ["deposit", "passed", true, "Failed the first time and passed when run again."],
      ["withdraw", "passed", false, undefined],
    ]);
    expect(out.tests[0]!.firstReason).toBe("“It went.”: it didn't");
    expect(new Set(ran.mock.calls.map((c) => address(c[0]))).size).toBe(3);
    expect(ran.mock.calls.map((c) => c[2].storageState)).toEqual(["setup-state.json", "setup-state-2.json", "setup-state-3.json"].map((f) => path.join(artifactsDir, f)));
    // A run never asks for a model.
    expect(ran.mock.calls.map((c) => c[2].byModel)).toEqual([undefined, undefined, undefined]);
    expect(out.setup).toEqual([pass]);
  }, 60_000);

  it("calls a test Couldn't verify when its account couldn't be paid, and says what the owner can put right", async () => {
    // Enough for the first account and not the second.
    const out = await runSuite({ target: target({ account: "new", fundedKey: await payer("30"), fund }), suite: Suite.parse({ setup, tests: [test("deposit"), test("withdraw")] }), artifactsDir });
    expect(out.tests.map((t) => t.outcome)).toEqual(["passed", "unverified"]);
    expect(out.tests[1]!.reason).toMatch(/^The key that funds the test accounts \(.*\) couldn't send 25 TUSD on Local: /);
    expect(out.tests[1]!.repairable).toBe(false);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(setupOrReset).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("runs nothing when the first account couldn't be paid", async () => {
    const input = { target: target({ account: "new", fundedKey: await payer("5"), fund }), suite: Suite.parse({ setup, tests: [test("deposit"), test("withdraw")] }), artifactsDir };
    const open = await openSuite(input);
    try {
      expect(open.stuck).toMatch(/couldn't send 25 TUSD on Local/);
      expect(open.stuckAt).toEqual({ reason: open.stuck, fix: "funds" });
    } finally {
      await open.close();
    }
    const out = await runSuite(input);
    expect(out.tests.map((t) => [t.outcome, t.reason === open.stuck])).toEqual([["unverified", true], ["unverified", true]]);
    expect(setupOrReset).not.toHaveBeenCalled();
    expect(ran).not.toHaveBeenCalled();
  }, 60_000);
});

describe("a kept account", () => {
  const fund = [{ chainId: CHAIN_ID, amount: "1" }];
  const kept = (more: Partial<DrillTarget> = {}) => target({ account: "kept", accounts: ACCOUNTS, fundedKey: DEPLOYER_KEY, fund, ...more });

  it("is the owner's key, set up once and put back by the reset before each test, with nothing sent to it", async () => {
    const before = await coin(deployer.address);
    const open = await openSuite({ target: kept(), suite: Suite.parse({ setup, reset }), artifactsDir });
    try {
      expect(address(open.env)).toBe(deployer.address);
      expect(open.env.target.accounts!.B).toBe(ACCOUNTS.B);
      expect(open.opts.storageState).toBe(path.join(artifactsDir, "setup-state.json"));
      const first = await open.fresh();
      const second = await open.fresh();
      expect([first.env, second.env]).toEqual([open.env, open.env]);
      expect(setupOrReset.mock.calls.map((c) => [c[1], c[2].as?.id, c[2].storageState && path.basename(c[2].storageState)])).toEqual([
        [setup, undefined, undefined],
        [reset, "reset-1", "setup-state.json"],
        [reset, "reset-2", "setup-state.json"],
      ]);
      expect(first.setup).toEqual([pass]);
      expect(first.reset).toEqual([pass, pass]);
      expect(first.opts.storageState).toBe(path.join(artifactsDir, "reset-state.json"));
      expect(await coin(deployer.address)).toBe(before);
    } finally {
      await open.close();
    }
  }, 30_000);

  it("starts every test from where the setup ended when there are no reset lines", async () => {
    const open = await openSuite({ target: kept({ fundedKey: undefined }), suite: Suite.parse({ setup }), artifactsDir });
    try {
      expect(open.env.target.accounts).toEqual(ACCOUNTS);
      const start = await open.fresh();
      expect(start.env).toBe(open.env);
      expect(start.reset).toBeUndefined();
      expect(start.opts.storageState).toBe(path.join(artifactsDir, "setup-state.json"));
      expect(setupOrReset).toHaveBeenCalledTimes(1);
    } finally {
      await open.close();
    }
  }, 30_000);

  it("calls a test Couldn't verify when the reset didn't finish, keeps the reset's lines, and goes on to the next test", async () => {
    const gone = LineResult.parse({ status: "unsure", by: "code", note: "The recording no longer fits the page." });
    setupOrReset
      .mockImplementationOnce(async (_env, lines, opts) => ({ steps: lines.steps.map(() => pass), storageState: opts.saveTo }))
      .mockImplementationOnce(async () => ({
        steps: [pass, gone],
        why: "At the step “Cancel every open order.”: The recording no longer fits the page.",
        stuck: { line: 2, sentence: "Cancel every open order.", reason: "The recording no longer fits the page.", fix: "repair" },
      }));
    const seen: TestResult[] = [];
    const out = await runSuite({ target: kept(), suite: Suite.parse({ setup, reset, tests: [test("deposit"), test("withdraw")] }), artifactsDir }, () => {}, { onTest: (r) => seen.push(r) });
    expect(out.tests[0]).toMatchObject({
      testId: "deposit",
      outcome: "unverified",
      reason: "The reset didn't finish. At the step “Cancel every open order.”: The recording no longer fits the page.",
      reset: [pass, gone],
      steps: [],
      // No model was there to do the line again, so repairing may put it right.
      repairable: true,
    });
    expect(out.tests[1]).toMatchObject({ testId: "withdraw", outcome: "passed", reset: [pass, pass] });
    expect(ran.mock.calls.map((c) => c[1].id)).toEqual(["withdraw"]);
    expect(seen).toEqual(out.tests);
  }, 30_000);

  it("runs nothing when the setup didn't finish", async () => {
    const refused = LineResult.parse({ status: "fail", by: "code", note: "The app refused the sign-in." });
    setupOrReset.mockImplementationOnce(async () => ({ steps: [refused], why: "At the step “Connect the wallet.”: The app refused the sign-in.", stuck: { line: 1, sentence: "Connect the wallet.", reason: "The app refused the sign-in." } }));
    const out = await runSuite({ target: kept(), suite: Suite.parse({ setup, reset, tests: [test("deposit")] }), artifactsDir });
    expect(out.setup).toEqual([refused]);
    expect(out.tests[0]).toMatchObject({ outcome: "unverified", reason: "The setup didn't finish. At the step “Connect the wallet.”: The app refused the sign-in.", repairable: false });
    expect(setupOrReset).toHaveBeenCalledTimes(1);
    expect(ran).not.toHaveBeenCalled();
  }, 30_000);
});

describe("OpenSuite.run", () => {
  it("lays what it is given over the start's opts, and tries once more on another start when the run broke on our side", async () => {
    ran.mockImplementationOnce(async () => {
      throw new Error("browser closed");
    });
    const open = await openSuite({ target: target({ account: "new" }), suite: Suite.parse({ setup }), artifactsDir }, () => {}, { byModel: true });
    try {
      const lines: number[] = [];
      const out = await open.run(test("deposit"), { byModel: false, onLine: (i) => lines.push(i) });
      expect(out.outcome).toBe("passed");
      expect(ran.mock.calls.map((c) => c[2].byModel)).toEqual([false, false]);
      expect(address(ran.mock.calls[0]![0])).not.toBe(address(ran.mock.calls[1]![0]));
      ran.mock.calls[1]![2].onLine?.(3, pass);
      expect(lines).toEqual([3]);
      expect((await open.run(test("withdraw"))).outcome).toBe("passed");
      expect(ran.mock.calls[2]![2].byModel).toBe(true);
    } finally {
      await open.close();
    }
  }, 30_000);
});
