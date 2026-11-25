/**
 * A clean start for each test: a new paid account, or the reset on a kept one. The chain is a real
 * Anvil; the walk through a setup, a reset or a test is stood in for, since it has tests of its own.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DrillTarget, LineResult, Suite, Test, type DrillEvent, type TestResult } from "@dappdrill/core";
import { newAccounts, type Env } from "../../src/run/env.js";
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
/** What a test's account holds: the chain's coin and the test token. */
const holds = async (env: Env) => [await coin(address(env)), await tokens(address(env))];
/** The test account gives away its test tokens, as a test that deposits them would. */
async function spend(env: Env, amount: string): Promise<void> {
  const wallet = createWalletClient({ account: privateKeyToAccount(env.target.accounts!.A as Hex), transport: http(fx.rpcUrl) });
  const sent = await wallet.writeContract({ abi: TOKEN_ABI, address: fx.token, functionName: "transfer", args: [deployer.address, parseUnits(amount, 6)], chain: null });
  await pub.waitForTransactionReceipt({ hash: sent, pollingInterval: 100 });
}
/** Less than this is what a transfer back leaves behind to pay for itself. */
const DUST = parseEther("0.001");
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
    const key = await payer("100");
    const open = await openSuite({ target: target({ account: "new", accounts: ACCOUNTS, fundedKey: key, fund }), suite: Suite.parse({ setup }), artifactsDir }, () => {}, { byModel: true });
    const made: Hex[] = [];
    try {
      expect(open.stuck).toBeUndefined();
      expect(setupOrReset).toHaveBeenCalledTimes(1);
      const first = await open.fresh();
      expect(setupOrReset).toHaveBeenCalledTimes(1);
      const second = await open.fresh();
      expect(setupOrReset).toHaveBeenCalledTimes(2);

      expect(first.env).not.toBe(open.env);
      expect([first.env.chains, second.env.chains]).toEqual([open.env.chains, open.env.chains]);
      const [a, b] = [address(first.env), address(second.env)];
      made.push(a, b);
      // The keys can be made again from the funding key and the id kept with the run.
      const { runId, fundedBy } = JSON.parse(await readFile(path.join(artifactsDir, "test-accounts.json"), "utf8"));
      expect(fundedBy).toBe(privateKeyToAccount(key).address);
      expect([first, second].map((s) => s.env.target.accounts)).toEqual([newAccounts({ fundedKey: key, runId }, 1), newAccounts({ fundedKey: key, runId }, 2)]);
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
    // Closing the suite sends back what its accounts held, whoever took them.
    expect(await tokens(privateKeyToAccount(key).address)).toBe(parseUnits("100", 6));
    for (const who of made) expect([(await coin(who)) < DUST, await tokens(who)]).toEqual([true, 0n]);
  }, 60_000);

  it("sends back what a test left, so a key that can pay one account pays every test in turn", async () => {
    const key = await payer("30");
    const home = privateKeyToAccount(key).address;
    const before = await coin(home);
    const said: DrillEvent[] = [];
    const suite = Suite.parse({ setup, tests: [test("deposit"), test("withdraw"), test("claim")] });
    const out = await runSuite({ target: target({ account: "new", fundedKey: key, fund }), suite, artifactsDir }, (e) => void said.push(e));
    expect(out.tests.map((t) => t.outcome)).toEqual(["passed", "passed", "passed"]);
    expect(await tokens(home)).toBe(parseUnits("30", 6));
    // Three accounts were paid a coin each, and the key is out only what the transfers cost.
    expect(before - (await coin(home)) < parseEther("0.01")).toBe(true);
    for (const [env] of ran.mock.calls) expect([(await coin(address(env))) < DUST, await tokens(address(env))]).toEqual([true, 0n]);
    const sentBack = said.flatMap((e) => (e.type === "log" && e.message.startsWith("Sent back") ? [e.message] : []));
    expect(sentBack).toHaveLength(3);
    expect(sentBack[0]).toMatch(/^Sent back 25 TUSD and 0\.9\d+ ETH on Local from the test account 0x/);
    expect(said.some((e) => e.type === "log" && e.level === "warn")).toBe(false);
  }, 90_000);

  it("pays a test what it says it starts with in place of the app's list, and nothing when it says nothing", async () => {
    const key = await payer("100");
    const held: Record<string, bigint[]> = {};
    ran.mockImplementation(async (env, t) => {
      held[t.id] = await holds(env);
      return result(t.id);
    });
    const own = [{ chainId: CHAIN_ID, token: fx.token, amount: "40", symbol: "TUSD" }];
    const suite = Suite.parse({ setup, tests: [test("deposit"), { ...test("whale"), fund: own }, { ...test("empty"), fund: [] }, test("withdraw")] });
    const out = await runSuite({ target: target({ account: "new", fundedKey: key, fund }), suite, artifactsDir });
    expect(out.tests.map((t) => t.outcome)).toEqual(["passed", "passed", "passed", "passed"]);
    expect(held).toEqual({
      deposit: [parseEther("1"), parseUnits("25", 6)],
      whale: [0n, parseUnits("40", 6)],
      empty: [0n, 0n],
      withdraw: [parseEther("1"), parseUnits("25", 6)],
    });
    // Tokens on an account with no coin still come back: the key pays for that transfer too.
    expect(await tokens(privateKeyToAccount(key).address)).toBe(parseUnits("100", 6));
  }, 90_000);

  it("hands the start made at open only to a caller that asks for what it was paid", async () => {
    const own = [{ chainId: CHAIN_ID, amount: "0.5" }];
    const open = await openSuite({ target: target({ account: "new", fundedKey: await payer("100"), fund }), suite: Suite.parse({ setup }), artifactsDir }, () => {}, { fund: own });
    try {
      const other = await open.fresh();
      expect(await holds(other.env)).toEqual([parseEther("1"), parseUnits("25", 6)]);
      const first = await open.fresh(undefined, [{ chainId: CHAIN_ID, amount: "0.5" }]);
      expect(await holds(first.env)).toEqual([parseEther("0.5"), 0n]);
      expect(first.opts.storageState).toBe(path.join(artifactsDir, "setup-state.json"));
      expect(other.opts.storageState).toBe(path.join(artifactsDir, "setup-state-2.json"));
    } finally {
      await open.close();
    }
  }, 60_000);

  it("pays the next start from what a start said to be finished held, as the maker does after its draft", async () => {
    // The key holds enough test tokens for one account at a time.
    const open = await openSuite({ target: target({ account: "new", fundedKey: await payer("30"), fund }), suite: Suite.parse({ setup }), artifactsDir });
    try {
      const draft = await open.fresh();
      expect(await tokens(address(draft.env))).toBe(parseUnits("25", 6));
      open.finished(draft);
      const next = await open.fresh();
      expect(next.why).toBeUndefined();
      expect([await tokens(address(draft.env)), await tokens(address(next.env))]).toEqual([0n, parseUnits("25", 6)]);
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
    // Enough for the first account and not the second, once the first test has spent what it was paid.
    ran.mockImplementationOnce(async (env, t) => {
      await spend(env, "25");
      return result(t.id);
    });
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
