/**
 * A fake engine with the same functions as src/api.ts. It drives no browser and no chain, but paces
 * itself and writes frames and screenshots like the real one, so the worker and the web app can be
 * built and tried without either.
 *
 * The fake app is a small USDC vault. The look comes back with five goals and one thing that looked
 * wrong. Withdrawing fails every time on a fault of the app and is kept for it, and so is claiming
 * rewards, which asks the wallet for something dangerous. Saying no in the wallet never goes the
 * same way twice and isn't kept, and what looked wrong turns out to be nothing.
 *
 * Selected with DAPPDRILL_FAKE_ENGINE=1. DAPPDRILL_FAKE_DELAY_MS sets the pace (default 100).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { LineResult, newId, nowIso, sentence, Test, type ChainConfig, type DrillEventSink, type DrillTarget, type SigningReview, type TestResult } from "@dappdrill/core";
import type * as api from "../api.js";
import { makeEach, TOGETHER } from "../make/each.js";
import { stripedPng } from "./png.js";

export interface Engine {
  makeTests: typeof api.makeTests;
  makeTest: typeof api.makeTest;
  runSuite: typeof api.runSuite;
}

/** The real engine, or the fake one when DAPPDRILL_FAKE_ENGINE=1. Loaded lazily so the fake path never loads Playwright. */
export async function loadEngine(): Promise<Engine> {
  if (process.env.DAPPDRILL_FAKE_ENGINE === "1") return fakeEngine;
  const real = await import("../api.js");
  return { makeTests: real.makeTests, makeTest: real.makeTest, runSuite: real.runSuite };
}

const VAULT = "0x9f3a6c1e0b7d4e2a8c5f1b3d7e9a2c4f6b8dc2e1";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const COLOURS: [number, number, number][] = [
  [240, 240, 236],
  [220, 226, 240],
  [236, 222, 214],
  [214, 236, 222],
];

/** What the fake app has to test, and how each test of it goes. */
interface Canned {
  goal: string;
  why: string;
  name: string;
  do: string;
  /** What the page says afterwards. */
  says: string;
  claim: string;
  ends: "passes" | "fails" | "dangerous" | "unsteady";
}

const CANNED: Canned[] = [
  { goal: "A user with USDC in the wallet deposits 100 of it into the vault.", why: "It is what the app is for", name: "Deposit 100 USDC", do: "Type 100 into the amount field and click Deposit, then approve the request in the wallet.", says: "Deposited 100 USDC", claim: "The vault balance is 100 USDC higher than before the deposit.", ends: "passes" },
  { goal: "A user with 100 USDC in the vault takes 40 of it back.", why: "Funds would be stuck", name: "Withdraw 40 USDC", do: "Open the Withdraw tab, type 40 and click Withdraw, then approve the request in the wallet.", says: "Withdrawn 40 USDC", claim: "The vault balance is 40 USDC lower than before the withdrawal.", ends: "fails" },
  { goal: "A user claims the rewards the vault shows for them.", why: "Rewards are why users stay", name: "Claim rewards", do: "Click Claim rewards and approve the request in the wallet.", says: "Rewards claimed", claim: "The rewards figure is back to zero.", ends: "dangerous" },
  { goal: "A user who asks to deposit more than the wallet holds is told so, and the wallet is asked nothing.", why: "A failed transaction costs gas", name: "Deposit more than the balance", do: "Type 5000000 into the amount field.", says: "Insufficient balance", claim: "The Deposit button can't be clicked.", ends: "passes" },
  { goal: "A user who says no in the wallet while depositing is told the deposit was cancelled.", why: "A stuck spinner looks like lost funds", name: "Reject a deposit", do: "Type 100 into the amount field and click Deposit, then reject the request in the wallet.", says: "Deposit cancelled", claim: "The form can be used again.", ends: "unsteady" },
];
const TOTAL = { what: "The vault's total differs from the sum of its rows", expected: "The page lists two positions under “Your total”, so the total is their sum.", saw: "Your total reads 104.20 USDC; the rows read 100.00 and 3.10.", goal: "A user with a deposit sees a total that equals the sum of the rows under it." };
const FAULTS: Partial<Record<Canned["ends"], { what: string; expected: string; saw: string }>> = {
  fails: { what: "A withdrawal leaves the vault balance as it was", expected: "The page says “Withdrawn 40 USDC”, so the vault balance falls by 40.", saw: "The vault balance still reads 100.00 USDC after the withdrawal was mined." },
  dangerous: { what: "Claim rewards asks for an unlimited USDC approval", expected: "The button says “Claim rewards”, so the wallet is asked to claim.", saw: "The wallet was asked to approve unlimited USDC for a contract with no verified source." },
};

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "test";
const endsOf = (test: Pick<Test, "name" | "goal">): Canned["ends"] => (/withdraw|takes .* back/i.test(`${test.name} ${test.goal}`) ? "fails" : /claim/i.test(test.name) ? "dangerous" : "passes");

function testFor(c: Canned): Test {
  return Test.parse({
    id: slug(c.name),
    name: c.name,
    goal: c.goal,
    startPath: "/vault",
    steps: [
      { type: "action", by: "code", do: "Open the Vault page." },
      { type: "action", by: "llm", do: c.do },
      { type: "check", by: "code", claim: `The page says “${c.says}”.`, expect: { kind: "said", text: c.says } },
      { type: "check", by: "llm", claim: c.claim },
    ],
  });
}

/** A goal someone typed, as a test that passes. */
function typed(goal: string): Canned {
  const words = goal.replace(/^a user( who| with)?\s+/i, "").replace(/[.]$/, "");
  return { goal, why: "", name: words.charAt(0).toUpperCase() + words.slice(1, 48), do: `Do it: ${words}.`, says: "Done", claim: "The page shows it was done.", ends: "passes" };
}

async function beat(signal?: AbortSignal, n = 1) {
  signal?.throwIfAborted();
  await sleep(n * Number(process.env.DAPPDRILL_FAKE_DELAY_MS ?? 100), undefined, { signal });
}

let pictures = 0;

async function png(dir: string, rel: string): Promise<string> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, stripedPng(320, 200, COLOURS[pictures++ % COLOURS.length]!));
  return rel;
}

/** A live frame, sent the way a real session sends it: with the whole path of the file. */
async function frame(dir: string, sink: DrillEventSink, url: string) {
  const rel = await png(dir, `frames/${String(pictures).padStart(5, "0")}.png`);
  await sink({ type: "frame", path: path.join(dir, rel), url, at: nowIso() });
}

function chainsOf(target: DrillTarget): ChainConfig[] {
  const chains = target.chains.length > 0 ? target.chains : [{ id: 8453, name: "Base", rpcUrl: "https://base-rpc.publicnode.com", mode: "fork" as const }];
  return chains.map((c) => ({ ...c, forkBlock: c.forkBlock ?? "23456789" }));
}

function review(test: Test, dangerous: boolean): SigningReview {
  const spender = "0x9f3a2c7bd5e1f4a6c8b0d2e4f6a8c0b2d4e6f8a1";
  const base = { id: newId("sig"), requestId: newId("req"), testId: test.id, stepIndex: 1, chainId: 8453, method: "eth_sendTransaction", fingerprint: `fake-${test.id}`, simulation: { status: "ok" as const, balanceChanges: [] }, createdAt: nowIso() };
  if (!dangerous)
    return {
      ...base,
      verdict: "consistent",
      title: `${test.name.split(" ")[0]} on Harbor Vault`,
      summary: "Calls the verified vault contract with the amount shown on the page.",
      ui: { buttonLabel: test.name.split(" ")[0], pageUrl: "/vault" },
      decoded: { kind: "transaction", to: VAULT, contractName: "HarborVault", functionName: "deposit", signature: "deposit(uint256)", args: [{ name: "assets", type: "uint256", value: "100000000", display: "100 USDC" }], abiSource: "sourcify" },
      approvals: [],
      checks: [{ id: "verified-source", label: "Verified source", status: "pass", detail: "Verified on Sourcify." }],
      explanation: "Target, function and amount match what the page showed.",
    };
  return {
    ...base,
    verdict: "dangerous",
    title: "Unlimited USDC approval to an unverified contract",
    summary: "The Claim button asks for an unlimited USDC approval to a contract with no verified source, not a claim.",
    ui: { buttonLabel: "Claim rewards", pageUrl: "/vault" },
    decoded: { kind: "transaction", to: USDC, contractName: "USDC", functionName: "approve", signature: "approve(address,uint256)", args: [{ name: "spender", type: "address", value: spender, display: spender }, { name: "amount", type: "uint256", value: "115792089237316195423570985008687907853269984665640564039457584007913129639935", display: "unlimited" }], abiSource: "sourcify" },
    approvals: [{ standard: "erc20", token: USDC, symbol: "USDC", spender, amount: "", display: "unlimited USDC", unlimited: true }],
    checks: [
      { id: "ui-match", label: "Matches the button", status: "fail", detail: "The button says Claim rewards; the request is an approval." },
      { id: "verified-source", label: "Verified source", status: "fail", detail: "The spender has no verified source." },
    ],
    explanation: "The page offered a claim and the wallet was asked for an unlimited approval to a contract nobody can read.",
    advice: "Ask only for the claim. If an approval is needed, name the spender and the amount on the page.",
  };
}

interface Going {
  dir: string;
  sink: DrillEventSink;
  url: string;
  signal?: AbortSignal;
}

/** One run of a test: a line at a time, each with its picture. */
async function run(test: Test, ends: Canned["ends"], going: Going, onLine?: (index: number, result: LineResult) => void): Promise<TestResult> {
  const t0 = Date.now();
  const steps: LineResult[] = [];
  const failsAt = ends === "fails" ? test.steps.length - 1 : -1;
  for (const [i, line] of test.steps.entries()) {
    await beat(going.signal, 3);
    await frame(going.dir, going.sink, `${going.url}${test.startPath}`);
    const failed = i === failsAt;
    steps.push(
      LineResult.parse({
        status: failed ? "fail" : "pass",
        by: line.by,
        model: line.by === "llm" ? "claude-sonnet-5-5" : undefined,
        note: failed ? FAULTS.fails!.saw : "",
        did: line.type === "action" ? [`Did: ${sentence(line)}`] : [],
        screenshot: await png(going.dir, `screenshots/${test.id}-${i + 1}-${pictures}.png`),
        page: failed ? "Vault\nYour balance 100.00 USDC\nWithdrawn 40 USDC" : undefined,
        durationMs: 300,
        costUsd: line.by === "llm" ? 0.004 : 0,
      }),
    );
    onLine?.(i, steps[i]!);
  }
  const signs = /deposit|withdraw|claim/i.test(test.name) && !/more than|reject/i.test(test.name);
  const signingReviews = signs ? [review(test, ends === "dangerous")] : [];
  const reason =
    ends === "fails"
      ? `“${sentence(test.steps[failsAt]!)}”: ${FAULTS.fails!.saw}`
      : ends === "dangerous"
        ? `The wallet was asked for something dangerous: ${signingReviews[0]!.title}. ${signingReviews[0]!.explanation}`
        : undefined;
  return { testId: test.id, outcome: reason ? "failed" : "passed", reason, steps, values: {}, cleanup: [], signingReviews, rerun: false, durationMs: Date.now() - t0, costUsd: 0.012 };
}

const makeTest: Engine["makeTest"] = async (input, sink = () => {}, say = () => {}) => {
  const t0 = Date.now();
  const going: Going = { dir: input.artifactsDir, sink, url: input.target.url, signal: input.signal };
  const known = CANNED.find((c) => c.goal === input.goal);
  const canned = known ?? { ...typed(input.goal), ...(input.suspicion ? { name: "Total equals the rows" } : {}) };
  const ends = known?.ends ?? endsOf(canned);
  const done = (more: Partial<api.Made>): api.Made => ({ proven: false, notes: [], findings: [], repairs: [], dismissed: [], runs: [], draftUsd: 0.21, costUsd: 0.38, durationMs: Date.now() - t0, ...more });

  say(`Drafting: ${input.goal}`);
  for (let i = 0; i < 4; i++) {
    await beat(input.signal, 4);
    await frame(going.dir, sink, `${going.url}${input.startPath ?? "/"}`);
  }
  const test = testFor(canned);
  say(`Drafted “${test.name}”: ${test.steps.length} lines, $0.21`);

  const runs: TestResult[] = [];
  for (let n = 1; n <= (ends === "unsteady" ? 3 : 2); n++) {
    const went = await run(test, ends === "unsteady" && n % 2 ? "fails" : ends === "unsteady" ? "passes" : ends, going);
    runs.push(went);
    say(`Run ${n}: ${went.outcome === "passed" ? "Passed" : "Failed"}, 1 s, $0.01.${went.reason ? ` ${went.reason}` : ""}`);
  }
  if (ends === "unsteady") return done({ test, runs, worded: runs.length, why: "“Deposit cancelled” showed in one run and was gone before the check looked in the next.", ask: "After a rejected deposit, how long should “Deposit cancelled” stay on screen?" });
  if (input.suspicion) return done({ test, runs, proven: true, stands: "passed", dismissed: ["The total includes rewards not yet claimed, which the page says under the figure."] });
  const fault = FAULTS[ends];
  if (!fault) return done({ test, runs, proven: true, stands: "passed", notes: ends === "passes" && /deposit 100/i.test(test.name) ? ["The first deposit asks for an approval before the deposit itself."] : [] });
  say(`A second look agrees the app is at fault: ${fault.what}`);
  return done({ test, runs, proven: true, stands: "failed", findings: [{ ...fault, proven: true }] });
};

async function look(input: api.RunSuiteInput, sink: DrillEventSink, say: (text: string) => void = () => {}): Promise<api.Looked> {
  const t0 = Date.now();
  const dir = path.join(input.artifactsDir, "look");
  await sink({ type: "chains", chains: chainsOf(input.target) });
  say("Looking around");
  for (const page of ["/", "/vault", "/rewards", "/vault"]) {
    await beat(input.signal, 5);
    await frame(dir, sink, `${input.target.url}${page}`);
  }
  say("The test wallet starts with 1000 USDC on Base");
  await beat(input.signal, 5);
  const have = new Set(input.suite.tests.map((t) => t.goal));
  return {
    summary: "Harbor Vault takes USDC deposits and pays rewards on them. Everything happens on the Vault page.",
    goals: CANNED.filter((c) => !have.has(c.goal)).map((c) => ({ goal: c.goal, startPath: "/vault", why: c.why })),
    notes: input.suite.notes.some((n) => n.from === "look") ? [] : ["The Withdraw tab only appears once the wallet has a deposit."],
    problems: have.size ? [] : [TOTAL],
    live: false,
    chains: chainsOf(input.target),
    tokens: [{ chainId: 8453, address: USDC, amount: "1000", symbol: "USDC" }],
    setup: input.suite.setup?.steps.map((line) => LineResult.parse({ status: "pass", by: line.by, did: ["Clicked Connect wallet", "Chose MetaMask"] })),
    costUsd: 0.9,
    durationMs: Date.now() - t0,
  };
}

const makeTests: Engine["makeTests"] = async (input, sink = () => {}, progress = {}) => {
  const t0 = Date.now();
  const looked = await look(input, sink, progress.say);
  progress.onLooked?.(looked);
  const made = await makeEach(looked, { ...input, together: input.together ?? TOGETHER }, (asked, n) => makeTest({ ...input, ...asked, artifactsDir: path.join(input.artifactsDir, `make-${n}`) }, sink, (text) => progress.say?.(text, n)), progress);
  return { ...made, looked, costUsd: looked.costUsd + made.attempts.reduce((sum, a) => sum + (a.made?.costUsd ?? 0), 0), durationMs: Date.now() - t0 };
};

const runSuite: Engine["runSuite"] = async (input, sink = () => {}, progress = {}) => {
  const t0 = Date.now();
  const going: Going = { dir: input.artifactsDir, sink, url: input.target.url, signal: input.signal };
  await sink({ type: "chains", chains: chainsOf(input.target) });
  const setup = input.suite.setup?.steps.map((line) => LineResult.parse({ status: "pass", by: line.by, did: ["Clicked Connect wallet", "Chose MetaMask"] }));
  for (const [i, line] of (setup ?? []).entries()) {
    await beat(input.signal, 3);
    progress.onLine?.(undefined, i, line);
  }
  const tests: TestResult[] = [];
  for (const test of input.suite.tests) {
    const once = () => {
      progress.onStart?.(test.id);
      return run(test, endsOf(test), going, (i, r) => progress.onLine?.(test.id, i, r));
    };
    let result = await once();
    if (result.outcome === "failed") {
      const again = await once();
      result = { ...again, rerun: true, firstReason: result.reason, durationMs: result.durationMs + again.durationMs, costUsd: result.costUsd + again.costUsd };
    }
    tests.push(result);
    progress.onTest?.(result);
  }
  return { setup, tests, durationMs: Date.now() - t0, costUsd: tests.reduce((sum, t) => sum + t.costUsd, 0) };
};

export const fakeEngine: Engine = { makeTests, makeTest, runSuite };
