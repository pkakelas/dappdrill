/**
 * A fake engine with the same functions as src/api.ts. It drives no browser and
 * no chain, but paces itself and writes frames and screenshots like the real one,
 * so the worker and the web app can be built and tested without either.
 *
 * The fake app is a small USDC vault. "Withdraw" tests fail at their withdraw step and their
 * conditions can't run until it passes; the slow-RPC and low-gas conditions find a problem;
 * "Claim rewards" signs something dangerous; everything else passes.
 *
 * Selected with DAPPDRILL_FAKE_ENGINE=1. DAPPDRILL_FAKE_DELAY_MS sets the pace (default 100).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  conditionInfo,
  newId,
  nowIso,
  TestRunResult,
  type ChainConfig,
  type DrillEventSink,
  type DrillTarget,
  type Issue,
  type SigningReview,
  type Step,
  type TestStep,
  type WalletRequest,
} from "@dappdrill/core";
import type * as api from "../api.js";
import { stripedPng } from "./png.js";

export interface Engine {
  analyze: typeof api.analyze;
  runTests: typeof api.runTests;
  writeTest: typeof api.writeTest;
  chatTurn: typeof api.chatTurn;
}

const ACCOUNT = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4";
const VAULT = "0x9f3a6c1e0b7d4e2a8c5f1b3d7e9a2c4f6b8dc2e1";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const COLOURS: [number, number, number][] = [
  [240, 240, 236],
  [220, 226, 240],
  [236, 222, 214],
  [214, 236, 222],
];

let frames = 0;

async function beat(signal?: AbortSignal, n = 1) {
  signal?.throwIfAborted();
  await sleep(n * Number(process.env.DAPPDRILL_FAKE_DELAY_MS ?? 100), undefined, { signal });
}

async function png(artifactsDir: string, rel: string, colour = COLOURS[frames % COLOURS.length]!): Promise<string> {
  const abs = join(artifactsDir, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, stripedPng(320, 200, colour));
  return rel;
}

async function frame(artifactsDir: string): Promise<string> {
  frames++;
  return png(artifactsDir, `frames/${String(frames).padStart(4, "0")}.png`);
}

function chainsOf(target: DrillTarget): ChainConfig[] {
  const chains = target.chains.length > 0 ? target.chains : [{ id: 8453, name: "Base", rpcUrl: "https://base-rpc.publicnode.com", mode: "fork" as const }];
  return chains.map((c) => ({ ...c, forkBlock: c.forkBlock ?? "23456789" }));
}

const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

const analyze: Engine["analyze"] = async (target, opts, sink, signal) => {
  const log = (message: string) => sink({ type: "log", level: "info", message, at: nowIso() });
  const notes = [
    `Opening ${target.url}`,
    "The landing page explains a USDC vault on Base with a Launch app button",
    "The app lives at /vault: deposit, withdraw and claim rewards, all behind Connect wallet",
    "Connected with the test wallet; balance shows 1,000 USDC",
    "Rewards accrue per block and are claimed with a separate transaction",
  ];
  try {
    for (const n of notes) {
      await log(n);
      await sink({ type: "frame", path: await frame(opts.artifactsDir), url: target.url, at: nowIso() });
      await beat(signal, 6);
    }
  } catch (e) {
    if (!isAbort(e)) throw e;
    return { tests: [], untested: [], chains: chainsOf(target), costUsd: 0.04 };
  }
  const tests = [
    {
      name: "Deposit USDC",
      goal: "Deposit a small amount of USDC into the vault and see it counted.",
      expected: "Deposited shows 5.00 USDC and the wallet balance drops by 5.",
      startPath: "/vault",
      steps: ["Connect the wallet", "Enter 5 as the amount", "Click Deposit", "Approve in the wallet", "Check Deposited shows 5.00"],
    },
    {
      name: "Withdraw everything",
      goal: "Withdraw the whole deposit back to the wallet.",
      expected: "Deposited shows 0.00 and the balance is back to 1,000 USDC.",
      startPath: "/vault",
      steps: ["Connect the wallet", "Deposit 5 USDC first", "Click Withdraw", "Approve in the wallet", "Check Deposited shows 0.00"],
    },
    {
      name: "Claim rewards",
      goal: "Claim the accrued rewards into the wallet.",
      expected: "Claimable rewards shows 0.00 and a success message appears.",
      startPath: "/vault",
      steps: ["Connect the wallet", "Click Claim rewards", "Approve in the wallet", "Check rewards show 0.00"],
    },
  ];
  // Seen while exploring, nothing written: shows under Not tested yet.
  const untested = [{ name: "Borrow against the deposit", goal: "Take a USDC loan against what is in the vault." }];
  return {
    map: {
      summary: "Harbor is a USDC vault on Base. Users connect a wallet, deposit USDC to earn rewards, withdraw, and claim rewards.",
      pages: [
        { path: "/", purpose: "Landing page with a Launch app button" },
        { path: "/vault", purpose: "Deposit, withdraw and claim; needs a connected wallet" },
      ],
    },
    setup: {
      startPath: "/vault",
      steps: ["Connect the wallet", "Click Get test USDC", "Approve in the wallet", "Check the balance shows 1,000 USDC"],
      when: "once",
      why: "The faucet gives test USDC once per account.",
    },
    tests,
    untested,
    chains: chainsOf(target),
    costUsd: 0.06,
  };
};

const walletWords = /wallet|approve|sign|confirm/i;

function fakeActions(text: string): Step[] {
  if (/connect/i.test(text)) return [{ kind: "click", target: { role: "button", name: "Connect wallet" } }, { kind: "click", target: { role: "button", name: "MetaMask" } }];
  if (/approve|sign|confirm/i.test(text)) return [{ kind: "wallet", respond: "approve" }];
  const enter = /enter (\S+)/i.exec(text);
  if (enter) return [{ kind: "fill", target: { role: "textbox", name: "Amount" }, value: enter[1]! }];
  const check = /check (.+)/i.exec(text);
  if (check) return [{ kind: "expect", assert: { type: "visible", text: check[1]!.replace(/^the /, "") } }];
  const click = /click (.+)/i.exec(text);
  if (click) return [{ kind: "click", target: { role: "button", name: click[1]! } }];
  return [];
}

function did(actions: Step[]): string[] {
  return actions.map((a) =>
    a.kind === "click" ? `Click "${a.target.name}"` : a.kind === "fill" ? `Type "${a.value}" into "Amount"` : a.kind === "wallet" ? "Approve in wallet" : a.kind === "expect" && a.assert.type === "visible" ? `See "${a.assert.text}"` : a.kind,
  );
}

function signRequest(chainId: number, rejected: boolean): WalletRequest {
  return {
    id: newId("req"),
    method: "eth_sendTransaction",
    params: [{ from: ACCOUNT, to: VAULT }],
    chainId,
    from: ACCOUNT,
    kind: "sign",
    at: nowIso(),
    outcome: rejected ? "rejected" : "approved",
    error: rejected ? "User rejected the request. (4001)" : undefined,
    result: rejected ? undefined : `0x${"ab".repeat(32)}`,
  };
}

function review(request: WalletRequest, testName: string): SigningReview {
  if (/claim/i.test(testName)) return dangerousReview(request, testName);
  return {
    id: newId("sig"),
    requestId: request.id,
    testId: "fake",
    stepIndex: 0,
    chainId: request.chainId ?? 8453,
    method: "eth_sendTransaction",
    fingerprint: `fake-${testName}`,
    verdict: "consistent",
    title: `${testName.split(" ")[0]} on Harbor Vault`,
    summary: "Calls the verified vault contract with the amount shown on the page.",
    ui: { buttonLabel: testName.split(" ")[0], pageUrl: "/vault" },
    decoded: { kind: "transaction", to: VAULT, contractName: "HarborVault", functionName: "deposit", signature: "deposit(uint256)", args: [{ name: "assets", type: "uint256", value: "5000000", display: "5 USDC" }], abiSource: "sourcify" },
    simulation: { status: "ok", balanceChanges: [] },
    approvals: [],
    checks: [{ id: "verified-source", label: "Verified source", status: "pass", detail: "Verified on Sourcify." }],
    explanation: "Target, function and amount match what the page showed.",
    createdAt: nowIso(),
  };
}

/** The claim button sends an unlimited approval to an unverified contract: Dangerous. */
function dangerousReview(request: WalletRequest, testName: string): SigningReview {
  const spender = "0x9f3a2c7bd5e1f4a6c8b0d2e4f6a8c0b2d4e6f8a1";
  return {
    id: newId("sig"),
    requestId: request.id,
    testId: "fake",
    stepIndex: 0,
    chainId: request.chainId ?? 8453,
    method: "eth_sendTransaction",
    fingerprint: `fake-${testName}`,
    verdict: "dangerous",
    title: "Unlimited USDC approval to an unverified contract",
    summary: "The Claim button asks for an unlimited USDC approval to a contract with no verified source, not a claim.",
    ui: { buttonLabel: "Claim rewards", pageUrl: "/vault" },
    decoded: { kind: "transaction", to: USDC, contractName: "USDC", functionName: "approve", signature: "approve(address,uint256)", args: [{ name: "spender", type: "address", value: spender, display: spender }, { name: "amount", type: "uint256", value: "115792089237316195423570985008687907853269984665640564039457584007913129639935", display: "unlimited" }], abiSource: "sourcify" },
    simulation: { status: "ok", balanceChanges: [] },
    approvals: [{ standard: "erc20", token: USDC, symbol: "USDC", spender, amount: "", display: "unlimited USDC", unlimited: true }],
    checks: [
      { id: "ui-match", label: "Matches the button", status: "fail", detail: "The button says Claim rewards; the request is an approval." },
      { id: "approval", label: "Approval", status: "fail", detail: "Approves unlimited USDC for a spender that is not the vault." },
      { id: "verified-source", label: "Verified source", status: "fail", detail: "The spender has no verified source." },
    ],
    explanation: "An unlimited approval to an unknown, unverified spender behind a button labelled Claim rewards.",
    createdAt: nowIso(),
  };
}

const runTests: Engine["runTests"] = async (target, items, opts, hooks) => {
  const chains = chainsOf(target);
  const outcomes: api.TestOutcome[] = [];
  let setupRan = false;
  for (const item of items) {
    if (opts.signal?.aborted) break;
    const { spec } = item;
    const signal = item.signal;
    await hooks.onStart?.(spec.id);
    const source = item.base ?? spec;
    const result = TestRunResult.parse({ steps: source.steps.map(() => ({ status: "pending" })) });
    if (opts.setup) {
      const reused = opts.setup.when === "once" && setupRan;
      result.setup = { ok: true, when: opts.setup.when, reused, shared: false, steps: opts.setup.steps.map((s) => ({ status: "pass", via: "cache", did: did(s.actions ?? fakeActions(s.text)), durationMs: 900 })) };
      if (!reused) {
        await hooks.onProgress?.(spec.id, result);
        await beat(signal ?? opts.signal, 4);
        if (opts.setup.steps.some((s) => !s.actions)) await hooks.onSetupSteps?.(opts.setup.steps.map((s) => ({ text: s.text, actions: s.actions ?? fakeActions(s.text) })));
      }
      setupRan = true;
    }
    const steps: TestStep[] = source.steps.map((s) => ({ ...s }));
    const condition = spec.condition && conditionInfo(spec.condition);
    let status: api.TestOutcome["status"] = "pass";
    try {
      if (condition && !source.steps.some((s) => walletWords.test(s.text)) && !["slow-rpc", "failing-rpc"].includes(spec.condition!)) {
        status = "skipped";
        result.failure = "The test has no wallet step.";
        for (const s of result.steps) s.status = "skipped";
      } else if (condition && /withdraw/i.test(source.name)) {
        // The condition replays the base's steps; a base that fails can't lend them.
        await beat(signal ?? opts.signal, 3);
        status = "error";
        result.failure = `“${source.name}” has to pass before its conditions can run.`;
        for (const s of result.steps) s.status = "skipped";
      } else {
        for (const [i, step] of source.steps.entries()) {
          result.steps[i]!.status = "running";
          await hooks.onProgress?.(spec.id, result);
          await hooks.onFrame?.(spec.id, await frame(opts.artifactsDir));
          await beat(signal ?? opts.signal, step.actions ? 3 : 8);
          const actions = step.actions ?? fakeActions(step.text);
          const failsHere = !condition && /withdraw/i.test(spec.name) && /click withdraw/i.test(step.text);
          const rejected = spec.condition === "reject" && walletWords.test(step.text);
          if (walletWords.test(step.text) && !/connect/i.test(step.text)) {
            const req = signRequest(chains[0]!.id, rejected);
            result.walletRequests.push(req);
            if (!rejected) result.signingReviews.push(review(req, spec.name));
          }
          result.steps[i] = {
            status: failsHere ? "fail" : "pass",
            via: step.actions || condition ? "cache" : "agent",
            did: failsHere ? [] : did(actions),
            note: failsHere ? "The Withdraw button stays disabled after the deposit confirms." : rejected ? "Rejected in the wallet." : undefined,
            screenshot: await png(opts.artifactsDir, `screenshots/${newId("shot")}.png`, failsHere ? [236, 214, 210] : undefined),
            durationMs: step.actions ? 900 : 4200,
          };
          if (failsHere) {
            status = "fail";
            result.failure = `Step ${i + 1}, “${step.text}”: The Withdraw button stays disabled after the deposit confirms.`;
            for (const later of result.steps.slice(i + 1)) later.status = "skipped";
            break;
          }
          if (!condition) steps[i] = { text: step.text, actions };
          if (rejected) {
            for (const later of result.steps.slice(i + 1)) later.status = "skipped";
            break;
          }
          await hooks.onProgress?.(spec.id, result);
        }
        if (status === "pass" && condition) {
          const problem = spec.condition === "slow-rpc" ? "The deposit spinner never stops when the RPC is slow" : spec.condition === "low-gas" ? "No message when there isn't enough ETH for gas" : undefined;
          if (problem) {
            status = "fail";
            result.issues = [fakeIssue(problem, spec.condition!)];
            result.failure = problem;
          }
          result.verdict = { ok: !problem, reason: problem ?? (spec.condition === "reject" ? "Shows “Transaction rejected” with a Try again button." : condition.expected) };
        } else if (status === "pass") {
          result.verdict = { ok: true, reason: `Shows “${/check (.+)/i.exec(source.steps.at(-1)?.text ?? "")?.[1] ?? "the expected result"}”.` };
        }
      }
    } catch (e) {
      if (!isAbort(e)) throw e;
      status = "stopped";
      for (const s of result.steps) if (s.status === "pending" || s.status === "running") s.status = "skipped";
    }
    result.finalScreenshot = await png(opts.artifactsDir, `screenshots/${newId("final")}.png`);
    result.costUsd = condition ? 0.002 : source.steps.some((s) => !s.actions) ? 0.011 : 0.003;
    const outcome: api.TestOutcome = { testId: spec.id, status, result, steps: condition || status === "stopped" ? undefined : steps, proof: status === "pass" && !condition ? "Deposited" : undefined };
    if (condition && item.base?.steps.some((s) => !s.actions)) outcome.baseSteps = item.base.steps.map((s) => ({ text: s.text, actions: s.actions ?? fakeActions(s.text) }));
    outcomes.push(outcome);
    await hooks.onDone?.(outcome);
  }
  return { outcomes, chains, costUsd: outcomes.reduce((s, o) => s + o.result.costUsd, 0) };
};

function fakeIssue(title: string, edgeCase: NonNullable<api.TestItem["spec"]["condition"]>): Issue {
  return {
    id: newId("iss"),
    fingerprint: `fake-${edgeCase}`,
    severity: "medium",
    category: "ui",
    title,
    summary: title,
    expected: conditionInfo(edgeCase)?.expected ?? "",
    actual: title,
    stepsToReproduce: [],
    edgeCase,
    evidence: {},
    createdAt: nowIso(),
  };
}

const writeTest: Engine["writeTest"] = async (input) => {
  await beat(undefined, 8);
  const base = input.base;
  const ask = input.prompt.trim().replace(/\.$/, "");
  const name = ask.length > 40 ? `${ask.slice(0, 38)}…` : ask.charAt(0).toUpperCase() + ask.slice(1);
  return {
    draft: {
      name,
      goal: `${ask.charAt(0).toUpperCase() + ask.slice(1)}.`,
      expected: base?.expected ?? "The page confirms it worked.",
      startPath: base?.startPath ?? "/vault",
      steps: base ? base.steps.map((s) => s.text) : ["Connect the wallet", "Enter 5 as the amount", "Click Deposit", "Approve in the wallet", "Check Deposited shows 5.00"],
    },
    costUsd: 0.001,
  };
};

/** Picks a tool by keyword, so the panel's actions can be tried without a model. */
const chatTurn: Engine["chatTurn"] = async (_target, input) => {
  await beat(input.signal, 6);
  const call = async (name: string, args: unknown) => String(await input.tools.find((t) => t.name === name)!.handler(args));
  const testId = /\((test_[a-z0-9]+)\)/.exec(input.context ?? "")?.[1];
  const msg = input.message;
  let text: string;
  if (testId && /\bwhy\b|fail|broke/i.test(msg)) {
    const detail = await call("get_test", { testId });
    const failure = /^Latest run: fail(?:ed)?\. (.+)$/m.exec(detail)?.[1];
    text = failure ? `It failed at ${failure.replace(/^Step/, "step")} Nothing was sent to the wallet after that.` : "Its latest run didn't fail.";
  } else if (testId && /condition|unhappy|edge|reject/i.test(msg)) {
    await call("add_conditions", { testId });
    text = "Added the usual conditions and started them.";
  } else if (testId && /duplicate|fork|same|instead|but /i.test(msg)) {
    await call("duplicate_test", { testId, change: msg });
    text = "Duplicated it. The copy runs as soon as it's written.";
  } else if (/\brun\b/i.test(msg)) {
    if (testId) await call("run_tests", { testIds: [testId] });
    text = testId ? "Running it now." : "Which test? Open it and ask again, or use Run all.";
  } else if (/\b(add|new|write|create)\b/i.test(msg)) {
    await call("create_test", { request: msg });
    text = "Writing it. It runs as soon as it's written.";
  } else {
    const list = await call("list_tests", {});
    const count = list.split("\n").filter((l) => l.startsWith("- ")).length;
    const failing = list.split("\n").filter((l) => l.startsWith("- ") && /: fail/.test(l)).map((l) => l.slice(2).replace(/ \[.*$/, ""));
    text = !count ? "No tests yet. Ask me to add one." : failing.length ? `${failing.length} of ${count} failing: ${failing.join(", ")}.` : `All ${count} tests pass.`;
  }
  input.onText?.(text);
  return { text, costUsd: 0.001 };
};

export const fakeEngine: Engine = { analyze, runTests, writeTest, chatTurn };

export { loadEngine } from "./select.js";
