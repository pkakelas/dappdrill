/**
 * Run one flow under each requested edge case, each in a fresh session on
 * pinned fork state, and turn what we see into issues with plain titles.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createWalletClient, encodeFunctionData, http, maxUint256, parseAbi, type Hex as ViemHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  EDGE_CASES,
  chainName,
  edgeCaseInfo,
  newId,
  nowIso,
  paramValues,
  type DrillEventSink,
  type DrillTarget,
  type EdgeCaseId,
  type Flow,
  type FlowRun,
  type Issue,
  type SigningReview,
  type Variation,
  type WalletProfileId,
  type WalletRequest,
} from "@dappdrill/core";
import type { ChainController, Hex, Inbox, Llm, RecoveryJudge, SigningReviewer, WalletPolicy } from "../types.js";
import { createSession, type EngineSession } from "../browser/session.js";
import type { Wallet } from "../wallet/controller.js";
import { decodeBuiltin, spenderOf } from "./expectation.js";
import { edgeLabel, inspectRecovery, makeIssue, pickConsole, pickRpc, type IssueContext, type IssueDraft } from "./issues.js";
import { resolveLocator } from "./locators.js";
import { replayFlow, sameRequest, type ReplayFlowResult, type ReplayHooks } from "./replay.js";

export interface RunEdgeCasesOptions {
  target: DrillTarget;
  chains: ChainController;
  flow: Flow;
  edgeCases: EdgeCaseId[];
  variation?: Variation;
  reviewer?: SigningReviewer;
  reviewLlm?: Llm;
  judge?: RecoveryJudge;
  inbox?: Inbox;
  sink: DrillEventSink;
  artifactsDir: string;
  baselines?: Record<string, SigningReview>;
  headless?: boolean;
  video?: boolean;
  signal?: AbortSignal;
  stepTimeoutMs?: number;
  log?: (message: string) => void;
}

export interface RunEdgeCasesResult {
  runs: FlowRun[];
  issues: Issue[];
  signingReviews: SigningReview[];
}

const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

/** An ERC-20 approval the flow makes, learned from the happy run. */
interface ApprovalInfo {
  token: Hex;
  spender: Hex;
  signIndex: number;
}

interface Plan {
  flow: Flow;
  flowChain: number;
  otherChain: number;
  params: Record<string, string>;
  profile: WalletProfileId;
  account: "A" | "B";
  accounts: { A: string; B: string };
  walletSteps: number[];
  approval?: ApprovalInfo;
  /** Sign indexes that send transactions (from the happy run); undefined before it ran. */
  txSignIndexes?: number[];
}

export async function runEdgeCases(opts: RunEdgeCasesOptions): Promise<RunEdgeCasesResult> {
  const { flow, chains, sink } = opts;
  const log = opts.log ?? (() => {});
  const configs = chains.configs();
  if (configs.length === 0) throw new Error("runEdgeCases needs at least one chain");
  const flowChain = opts.variation?.chainId ?? flow.chainId ?? configs[0]!.id;
  if (!chains.has(flowChain)) throw new Error(`flow "${flow.name}" expects chain ${flowChain}, which is not running`);

  // Keys must be stable across the sessions of this matrix (approvals are set up outside the session).
  const accounts = opts.target.accounts ?? { A: generatePrivateKey(), B: generatePrivateKey() };
  const plan: Plan = {
    flow,
    flowChain,
    otherChain: configs.find((c) => c.id !== flowChain)?.id ?? (flowChain === 1 ? 11155111 : 1),
    params: paramValues(flow, opts.variation?.inputs),
    profile: opts.variation?.wallet ?? opts.target.wallets[0] ?? "metamask",
    account: opts.variation?.account ?? "A",
    accounts,
    walletSteps: flow.steps.flatMap((s, i) => (s.kind === "wallet" ? [i] : [])),
  };

  const ordered = [...new Set(opts.edgeCases)].sort((a, b) => EDGE_CASES.findIndex((e) => e.id === a) - EDGE_CASES.findIndex((e) => e.id === b));
  const result: RunEdgeCasesResult = { runs: [], issues: [], signingReviews: [] };
  await sink({ type: "flow-status", flowId: flow.id, status: "running" });

  for (const edgeCase of ordered) {
    if (opts.signal?.aborted) break;
    const skip = skipReason(edgeCase, plan, chains);
    if (skip) {
      const run = skippedRun(flow, edgeCase, opts.variation, skip, chains, flowChain);
      result.runs.push(run);
      await sink({ type: "run", run });
      log(`${edgeCase}: skipped (${skip})`);
      continue;
    }
    log(`${edgeCase}: running`);
    const outcome = await runOne(edgeCase, plan, opts);
    // A run cut short by a stop is not a result.
    if (opts.signal?.aborted && outcome.run.status !== "pass") break;
    result.runs.push(outcome.run);
    result.issues.push(...outcome.issues);
    result.signingReviews.push(...outcome.reviews);
    for (const issue of outcome.issues) await sink({ type: "issue", issue });
    await sink({ type: "run", run: outcome.run });
    log(`${edgeCase}: ${outcome.run.status}${outcome.run.reason ? ` (${outcome.run.reason})` : ""}, ${outcome.issues.length} issue(s)`);
  }

  const happy = result.runs.find((r) => r.edgeCase === "happy");
  const status = happy && (happy.status === "fail" || happy.status === "error") ? "failed" : result.issues.length > 0 ? "issue" : result.runs.length ? "tested" : "queued";
  await sink({ type: "flow-status", flowId: flow.id, status });
  return result;
}

// ---------------------------------------------------------------- applicability

function skipReason(edge: EdgeCaseId, plan: Plan, chains: ChainController): string | undefined {
  const info = edgeCaseInfo(edge);
  const live = chains.mode(plan.flowChain) === "live";
  if (info.needsFork && live) return `needs a fork; ${chainName(plan.flowChain)} runs in live mode`;
  const needsWallet = !["happy", "slow-rpc", "failing-rpc"].includes(edge);
  if (needsWallet && plan.walletSteps.length === 0) return "the flow has no wallet step";
  if ((edge === "existing-approval" || edge === "revoked-approval") && !plan.approval) {
    return plan.txSignIndexes ? "the flow doesn't approve a token" : "needs the happy path first to learn the flow's approval";
  }
  if ((edge === "speed-up" || edge === "reload-mid-flow" || edge === "low-gas") && plan.txSignIndexes && plan.txSignIndexes.length === 0) return "the flow sends no transaction";
  return undefined;
}

function skippedRun(flow: Flow, edgeCase: EdgeCaseId, variation: Variation | undefined, reason: string, chains: ChainController, flowChain: number): FlowRun {
  const at = nowIso();
  return {
    id: newId("run"),
    flowId: flow.id,
    edgeCase,
    variationId: variation?.id,
    status: "skipped",
    reason,
    steps: [],
    walletRequests: [],
    signingReviewIds: [],
    issueIds: [],
    console: [],
    rpc: [],
    forkBlocks: forkBlocks(chains),
    mode: chains.mode(flowChain),
    startedAt: at,
    finishedAt: at,
  };
}

function forkBlocks(chains: ChainController): Record<string, string> {
  return Object.fromEntries(chains.configs().flatMap((c) => (c.forkBlock ? [[String(c.id), c.forkBlock]] : [])));
}

// ---------------------------------------------------------------- one edge case

interface CaseSetup {
  /** Plain-language setup lines for "steps to reproduce". */
  setup: string[];
  startChainId?: number;
  policy?: Partial<WalletPolicy>;
  twoWallets?: boolean;
  faults?: { latencyMs?: number; failureRate?: number };
  stepTimeoutFactor?: number;
  /** What a good app would do; also the judge's prompt. */
  expected?: string;
  prepare?: (session: EngineSession) => Promise<void>;
  hooks?: ReplayHooks;
  /** Extra checks after the replay. */
  inspect?: (session: EngineSession, replay: ReplayFlowResult, drafts: IssueDraft[]) => Promise<void>;
}

interface CaseOutcome {
  run: FlowRun;
  issues: Issue[];
  reviews: SigningReview[];
}

async function runOne(edge: EdgeCaseId, plan: Plan, opts: RunEdgeCasesOptions): Promise<CaseOutcome> {
  const { chains, flow } = opts;
  const runId = newId("run");
  const startedAt = nowIso();
  const log = opts.log ?? (() => {});
  const drafts: IssueDraft[] = [];
  const state: CaseState = { drafts };
  const setup = caseSetup(edge, plan, opts, state);

  // Pin state: snapshot every fork, revert afterwards.
  const snapshots: [number, string][] = [];
  for (const c of chains.configs()) if (c.mode === "fork") snapshots.push([c.id, await chains.snapshot(c.id)]);

  let session: EngineSession | undefined;
  let replay: ReplayFlowResult | undefined;
  let artifacts: { video?: string; trace?: string } = {};
  let finalScreenshot: string | undefined;
  let error: string | undefined;
  try {
    session = await createSession({ ...opts.target, accounts: plan.accounts }, chains, {
      artifactsDir: opts.artifactsDir,
      sink: opts.sink,
      headless: opts.headless,
      video: opts.video,
      wallet: plan.profile,
      twoWallets: setup.twoWallets,
      startChainId: setup.startChainId ?? plan.flowChain,
      policy: setup.policy,
      runId,
      log,
    });
    if (plan.account === "B") await session.wallet.switchAccount("B");
    await setup.prepare?.(session);
    if (setup.faults) chains.setFaults(setup.faults);

    replay = await replayFlow(session, flow, {
      params: plan.params,
      reviewer: opts.reviewer,
      reviewLlm: opts.reviewLlm,
      baselines: opts.baselines,
      inbox: opts.inbox,
      stepTimeoutMs: (opts.stepTimeoutMs ?? 15_000) * (setup.stepTimeoutFactor ?? 1),
      // A slow RPC delays the wallet request too: the app reads state before it asks.
      signTimeoutMs: 30_000 * (setup.stepTimeoutFactor ?? 1),
      hooks: setup.hooks,
      runId,
      signal: opts.signal,
      log,
    });
    chains.setFaults({});
    if (edge === "happy") learnFromHappy(plan, replay);

    finalScreenshot = await session.screenshot(`${runId}-final`);
    await setup.inspect?.(session, replay, drafts);
    commonChecks(edge, plan, session, replay, drafts);
    await blankCheck(edge, session, replay, drafts);
    // A flow that still completed was recovered from; the judge only looks at where it stopped.
    if (setup.expected && opts.judge && drafts.length === 0 && !replay.completed && replay.walletSteps.length > 0) {
      await askJudge(opts.judge, session, edge, setup.expected, drafts, finalScreenshot, opts.artifactsDir);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log(`${edge}: engine error: ${error}`);
  } finally {
    chains.setFaults({});
    if (session) {
      artifacts = await session.close().catch(() => ({}));
    }
    for (const c of chains.configs()) if (c.mode === "fork") await chains.setAutomine(c.id, true).catch(() => {});
    for (const [id, snap] of snapshots) await chains.revert(id, snap).catch((e) => log(`revert on chain ${id} failed: ${e.message}`));
  }

  const ctx: IssueContext = {
    flow,
    edgeCase: edge,
    runId,
    setup: setup.setup,
    evidence: {
      screenshot: finalScreenshot,
      video: artifacts.video,
      trace: artifacts.trace,
      console: session ? pickConsole(session.console) : undefined,
      rpc: session ? pickRpc(session.rpc) : undefined,
    },
  };
  // Two checks can see the same problem (a second click and a repeated request): keep the first.
  const seen = new Set<string>();
  const unique = drafts.filter((d) => {
    const key = `${d.kind}:${d.stepIndex ?? ""}`;
    return !seen.has(key) && Boolean(seen.add(key));
  });
  const issues = unique.map((d) => makeIssue(ctx, d));
  const wallet = session?.wallet;
  const status = runStatus(edge, replay, issues, error, wallet);

  const run: FlowRun = {
    id: runId,
    flowId: flow.id,
    edgeCase: edge,
    variationId: opts.variation?.id,
    status: status.status,
    reason: status.reason,
    steps: replay?.steps ?? [],
    walletRequests: replay?.walletRequests ?? wallet?.requests() ?? [],
    signingReviewIds: replay?.signingReviews.map((r) => r.id) ?? [],
    issueIds: issues.map((i) => i.id),
    console: session?.console ?? [],
    rpc: session?.rpc ?? [],
    video: artifacts.video,
    trace: artifacts.trace,
    finalScreenshot,
    forkBlocks: forkBlocks(chains),
    mode: chains.mode(plan.flowChain),
    startedAt,
    finishedAt: nowIso(),
  };
  for (const issue of issues) issue.runId = run.id;
  return { run, issues, reviews: replay?.signingReviews ?? [] };
}

function runStatus(edge: EdgeCaseId, replay: ReplayFlowResult | undefined, issues: Issue[], error: string | undefined, wallet?: Wallet): { status: FlowRun["status"]; reason?: string } {
  if (wallet?.needsLiveKey) return { status: "skipped", reason: `needs a funded test key for ${chainName(wallet.chainId())} (live mode)` };
  if (error) return { status: "error", reason: error };
  if (!replay) return { status: "error", reason: "no replay result" };
  if (issues.length > 0) return { status: "issue", reason: issues[0]!.title };
  if (replay.completed || replay.stoppedByHook) return { status: "pass" };
  // Apps often make a new account sign in or set up again; not finishing as B isn't a bug by itself.
  if (edge === "switch-account") return { status: "skipped", reason: `couldn't finish as the second account (${replay.error ?? "the flow stopped"}); no requests from the old account` };
  return { status: "fail", reason: replay.error ?? `the flow did not complete under ${edgeLabel(edge)}` };
}

/** What the happy run teaches us about the flow: which sign steps send transactions and whether one is an ERC-20 approval. */
function learnFromHappy(plan: Plan, replay: ReplayFlowResult): void {
  plan.txSignIndexes = [];
  replay.walletSteps.forEach((ws, signIndex) => {
    if (ws.request.method === "eth_sendTransaction" || ws.request.method === "wallet_sendCalls") plan.txSignIndexes!.push(signIndex);
    const decoded = decodeBuiltin(ws.request);
    const spender = spenderOf(decoded);
    if (!plan.approval && decoded.kind === "transaction" && decoded.functionName === "approve" && decoded.to && spender && decoded.args.length === 2) {
      plan.approval = { token: decoded.to as Hex, spender: spender as Hex, signIndex };
    }
  });
}

interface CaseState {
  drafts: IssueDraft[];
  stoppedAtStep?: number;
}

// ---------------------------------------------------------------- per-case setup

function caseSetup(edge: EdgeCaseId, plan: Plan, opts: RunEdgeCasesOptions, state: CaseState): CaseSetup {
  const { chains } = opts;
  // The flow's main request: its last transaction, or its last signature when it sends none
  // (an order on an off-chain book comes after the sign-in signature, not before).
  const lastTxSign = plan.txSignIndexes?.at(-1) ?? Math.max(0, plan.walletSteps.length - 1);
  const firstWalletStep = plan.walletSteps[0] ?? -1;
  /** Index of the step that triggers the first signing request (the one before the first wallet step). */
  const triggerStep = Math.max(0, firstWalletStep - 1);
  /** The wallet step of the flow's main transaction, and the click that asks for it. */
  const mainWalletStep = plan.walletSteps[lastTxSign] ?? firstWalletStep;
  const mainClick = plan.flow.steps.findLastIndex((st, i) => i < mainWalletStep && st.kind === "click");

  switch (edge) {
    case "happy":
      return { setup: [] };

    case "reject":
      return {
        // The main transaction (the deposit, not the approval before it) is where a rejection most often leaves the UI stuck.
        setup: ["Reject the flow's main request in the wallet (error 4001)."],
        expected: "Show that the request was rejected and let the user try again.",
        hooks: {
          respond: async (ctx) => (ctx.signIndex === lastTxSign ? "reject" : "default"),
          afterStep: async (ctx) => (ctx.step.kind === "wallet" && ctx.signIndex === lastTxSign ? "stop" : undefined),
        },
        inspect: (session, replay, drafts) => recoveryChecks("reject", session, replay, drafts, "rejecting"),
      };

    case "low-gas":
      return {
        setup: ["Leave the wallet with almost no ETH for gas."],
        expected: "Tell the user there isn't enough ETH for gas and let them try again.",
        prepare: async (session) => {
          await chains.setBalance(plan.flowChain, session.wallet.accounts[plan.account], 1_000n);
        },
        hooks: {
          afterStep: async (ctx, r) => (ctx.step.kind === "wallet" ? "stop" : r.status === "fail" ? "stop" : undefined),
        },
        inspect: (session, replay, drafts) => recoveryChecks("low-gas", session, replay, drafts, "running out of gas for"),
      };

    case "wrong-network":
      return {
        setup: [`Start with the wallet on ${chainName(plan.otherChain)} instead of ${chainName(plan.flowChain)}.`],
        startChainId: plan.otherChain,
        expected: "Notice the wrong network and ask the wallet to switch before sending anything.",
        hooks: wrongChainGuard(plan, state),
        inspect: async (session, replay, drafts) => {
          if (replay.completed || replay.stoppedByHook) return;
          const switched = session.wallet.requests().some((r) => r.kind === "switch");
          const rec = await inspectRecovery(session.page);
          if (!switched && !/wrong network|switch|unsupported/i.test(rec.pageText)) {
            drafts.push({
              kind: "no-network-handling",
              severity: "high",
              category: "wallet",
              title: `Doesn't handle the wallet being on ${chainName(plan.otherChain)}`,
              summary: `With the wallet on the wrong network the flow broke (${replay.error}) and the dApp neither asked to switch nor told the user.`,
              expected: `Ask the wallet to switch to ${chainName(plan.flowChain)} or show a "wrong network" message.`,
              actual: replay.error,
            });
          }
        },
      };

    case "unknown-chain":
      return {
        setup: [`Start with the wallet on ${chainName(plan.otherChain)}; the wallet answers the first switch with 4902 (unknown chain).`],
        startChainId: plan.otherChain,
        policy: { unknownChainOnce: true },
        expected: "Add the chain to the wallet (wallet_addEthereumChain) when the wallet doesn't know it yet.",
        hooks: wrongChainGuard(plan, state),
        inspect: async (session, replay, drafts) => {
          if (replay.completed || replay.stoppedByHook) return;
          const reqs = session.wallet.requests();
          const got4902 = reqs.some((r) => r.method === "wallet_switchEthereumChain" && r.error?.startsWith("4902"));
          const added = reqs.some((r) => r.method === "wallet_addEthereumChain");
          if (got4902 && !added) {
            drafts.push({
              kind: "no-add-chain",
              severity: "high",
              category: "wallet",
              title: `Gives up when the wallet doesn't know ${chainName(plan.flowChain)} (error 4902)`,
              summary: `The wallet answered wallet_switchEthereumChain with 4902 and the dApp never called wallet_addEthereumChain; the flow then broke (${replay.error}).`,
              expected: "Call wallet_addEthereumChain and retry the switch.",
              actual: replay.error,
            });
          }
        },
      };

    case "switch-account": {
      let switched = false;
      return {
        setup: ["Switch the wallet to account B right before the step that triggers the first signing request."],
        expected: "Use the newly selected account for everything that follows.",
        hooks: {
          beforeStep: async (ctx) => {
            if (ctx.index !== triggerStep || switched) return;
            switched = true;
            await giveTokensLikeA(plan, chains, ctx.session.wallet);
            await ctx.session.wallet.switchAccount("B");
            await ctx.session.page.waitForTimeout(800);
          },
          respond: async (ctx) => {
            const from = requestSigner(ctx.pending.request);
            const current = ctx.session.wallet.address().toLowerCase();
            if (from && from !== current) {
              state.drafts.push({
                kind: "stale-account",
                severity: "critical",
                category: "wallet",
                title: `After switching accounts, ${requestVerb(ctx.pending.request)} still comes from the old account`,
                summary: `The wallet switched to ${current} but the dApp asked to sign from ${from}. A real wallet refuses this, and a user who switched accounts would act on the wrong one.`,
                expected: `Sign from ${current}, the account the wallet now exposes.`,
                actual: `The request names ${from}.`,
                stepIndex: ctx.index,
                evidence: { buttonLabel: ctx.pending.buttonLabel, walletAsked: ctx.pending.request.method },
              });
              state.stoppedAtStep = ctx.index;
              return "reject";
            }
            return "default";
          },
          afterStep: async (ctx) => (state.stoppedAtStep === ctx.index ? "stop" : undefined),
        },
      };
    }

    case "two-wallets": {
      const other: WalletProfileId = plan.profile === "metamask" ? "rabby" : "metamask";
      return {
        setup: [`Have two wallets installed (${walletName(plan.profile)} and ${walletName(other)}), pick ${walletName(plan.profile)} in the dApp.`],
        twoWallets: true,
        inspect: async (session, _replay, drafts) => {
          const used = [...session.wallet.usedWallets];
          if (used.includes(other)) {
            drafts.push({
              kind: "wrong-provider",
              severity: "high",
              category: "wallet",
              title: `With two wallets installed, the dApp talks to ${walletName(other)} instead of ${walletName(plan.profile)}`,
              summary: `Both wallets announced themselves through EIP-6963 and the user picked ${walletName(plan.profile)}, but requests went to ${walletName(other)} (probably via window.ethereum). Users with two wallets end up signing with the wrong one.`,
              expected: `Use the provider from the EIP-6963 announcement the user selected.`,
              actual: `Requests used: ${used.map(walletName).join(", ")}.`,
            });
          }
        },
      };
    }

    case "slow-rpc":
      return {
        setup: ["Every RPC call takes 2.5 seconds.", "Click the main button a second time while the app is busy, as an impatient user would."],
        faults: { latencyMs: 2_500 },
        stepTimeoutFactor: 4,
        hooks: {
          afterStep: async (ctx) => {
            if (ctx.index !== mainClick || ctx.step.kind !== "click") return;
            // A button that is disabled while busy makes this click time out, which is the right behaviour.
            const el = await resolveLocator(ctx.session.page, ctx.step.target, 500).catch(() => undefined);
            await el?.click({ timeout: 800 }).catch(() => {});
          },
        },
        inspect: async (session, replay, drafts) => {
          const main = replay.walletSteps.find((w) => w.stepIndex === mainWalletStep);
          const dupes = main ? session.wallet.requests().filter((r) => r.id !== main.request.id && r.kind === "sign" && sameRequest(r, main.request)) : [];
          if (main && dupes.length > 0) {
            drafts.push({
              kind: "double-submission",
              severity: "high",
              category: "wallet",
              title: `Clicking '${main.pending.buttonLabel ?? "the button"}' twice while the app is busy sends two requests`,
              summary: `With a slow RPC the button stayed clickable, and a second click produced another ${main.request.method} (${main.asked}). A user who approves both pays twice.`,
              expected: "Disable the button as soon as it is clicked, until the request is answered.",
              actual: `${dupes.length + 1} identical requests from two clicks.`,
              stepIndex: main.stepIndex,
              evidence: { buttonLabel: main.pending.buttonLabel, walletAsked: main.asked },
            });
          }
          if (!replay.completed && !replay.stoppedByHook) {
            drafts.push({
              kind: "slow-rpc-breaks",
              severity: "medium",
              category: "rpc",
              title: "Flow breaks when the RPC is slow",
              summary: `With 2.5s of latency on every RPC call the flow did not complete: ${replay.error}.`,
              expected: "Keep working, just slower, with a loading state.",
              actual: replay.error,
            });
          }
        },
      };

    case "failing-rpc":
      return {
        setup: ["About 30% of RPC calls fail with an internal error."],
        faults: { failureRate: 0.3 },
        stepTimeoutFactor: 2,
        expected: "Retry or show a clear error when an RPC call fails.",
        inspect: async (_s, replay, drafts) => {
          if (!replay.completed && !replay.stoppedByHook) {
            drafts.push({
              kind: "failing-rpc-breaks",
              severity: "medium",
              category: "rpc",
              title: "Flow breaks when some RPC calls fail",
              summary: `With 30% of RPC calls failing the flow did not complete: ${replay.error}.`,
              expected: "Retry failed reads, or show the user what went wrong.",
              actual: replay.error,
            });
          }
        },
      };

    case "reload-mid-flow":
      return {
        setup: ["Turn off automatic mining, send the transaction, reload the page while it is pending, then mine it."],
        expected: "After the reload, show the pending transaction and then its confirmation.",
        hooks: {
          beforeStep: async (ctx) => {
            if (ctx.step.kind === "wallet" && ctx.signIndex === lastTxSign) await chains.setAutomine(plan.flowChain, false);
          },
          afterStep: async (ctx, r) => {
            if (ctx.step.kind !== "wallet" || ctx.signIndex !== lastTxSign || r.status !== "pass") return;
            await ctx.session.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
            await ctx.session.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
            await chains.setAutomine(plan.flowChain, true);
            await chains.mine(plan.flowChain);
          },
        },
        inspect: async (_s, replay, drafts) => {
          if (!replay.completed) {
            drafts.push({
              kind: "reload-loses-tx",
              severity: "medium",
              category: "ui",
              title: "Reloading while a transaction is pending loses track of it",
              summary: `The transaction was sent, the page was reloaded while it was pending, and the flow never reached its end: ${replay.error}.`,
              expected: "Remember pending transactions (e.g. in local storage) and show their outcome after a reload.",
              actual: replay.error,
            });
          }
        },
      };

    case "speed-up":
      return {
        setup: ["Turn off automatic mining, send the transaction, replace it with a higher-fee copy (same nonce), then mine."],
        expected: "Notice the replacement and show the transaction as confirmed.",
        hooks: {
          beforeStep: async (ctx) => {
            if (ctx.step.kind === "wallet" && ctx.signIndex === lastTxSign) await chains.setAutomine(plan.flowChain, false);
          },
          afterStep: async (ctx, r) => {
            if (ctx.step.kind !== "wallet" || ctx.signIndex !== lastTxSign || r.status !== "pass") return;
            await ctx.session.wallet.speedUpLast();
            await chains.setAutomine(plan.flowChain, true);
            await chains.mine(plan.flowChain);
          },
        },
        inspect: async (_s, replay, drafts) => {
          if (!replay.completed) {
            drafts.push({
              kind: "replaced-tx-ignored",
              severity: "medium",
              category: "ui",
              title: "Doesn't notice when a pending transaction is sped up",
              summary: `The transaction was replaced from the wallet (same nonce, higher fee) and mined, but the dApp kept waiting for the original hash: ${replay.error}.`,
              expected: "Detect the replacement (nonce mined under another hash) and show the result.",
              actual: replay.error,
            });
          }
        },
      };

    case "existing-approval": {
      const approval = plan.approval!;
      let reApproved: WalletRequest | undefined;
      return {
        setup: [`Approve the token for ${approval.spender} (unlimited) before starting.`],
        prepare: async (session) => setAllowance(chains, plan, session.wallet, approval, maxUint256),
        hooks: {
          beforeStep: async (ctx) => {
            if (ctx.step.kind !== "wallet" || ctx.signIndex !== approval.signIndex) return;
            // The dApp should skip the approval now; if the next request isn't an approve, skip this step.
            const next = await waitForQueuedSign(ctx.session.wallet, (opts.stepTimeoutMs ?? 15_000) * 2);
            if (!next) return;
            const decoded = decodeBuiltin(next.request);
            if (decoded.functionName === "approve") reApproved = next.request;
            else return "skip";
          },
        },
        inspect: async (_s, replay, drafts) => {
          if (reApproved) {
            drafts.push({
              kind: "needless-approval",
              severity: "medium",
              category: "wallet",
              title: "Asks for a token approval that was already granted",
              summary: "The token was already approved for the spender (unlimited) before the flow started, but the dApp still asked the wallet to approve again. Users pay for an extra transaction.",
              expected: "Read the current allowance and skip the approval when it is sufficient.",
              actual: "An approve transaction was requested.",
              stepIndex: plan.walletSteps[approval.signIndex],
              evidence: { walletAsked: "approve" },
            });
          }
          if (!replay.completed) {
            drafts.push({
              kind: "existing-approval-breaks",
              severity: "medium",
              category: "wallet",
              title: "Flow breaks when the token is already approved",
              summary: `With an existing approval in place the flow did not complete: ${replay.error}.`,
              actual: replay.error,
            });
          }
        },
      };
    }

    case "revoked-approval": {
      const approval = plan.approval!;
      return {
        setup: [`Set the token allowance for ${approval.spender} to zero before starting.`],
        prepare: async (session) => setAllowance(chains, plan, session.wallet, approval, 0n),
        inspect: async (_s, replay, drafts) => {
          if (!replay.completed) {
            drafts.push({
              kind: "revoked-approval-breaks",
              severity: "medium",
              category: "wallet",
              title: "Flow breaks after a previous approval was revoked",
              summary: `With the allowance explicitly set to zero the flow did not complete: ${replay.error}.`,
              actual: replay.error,
            });
          }
        },
      };
    }
  }
}

/** For wrong-network / unknown-chain: never let a transaction go out on the wrong chain, and report it. */
function wrongChainGuard(plan: Plan, state: CaseState): ReplayHooks {
  return {
    respond: async (ctx) => {
      const req = ctx.pending.request;
      if (req.method === "eth_sendTransaction" && req.chainId !== plan.flowChain) {
        state.drafts.push({
          kind: "wrong-chain-tx",
          severity: "critical",
          category: "wallet",
          title: `Sends ${requestVerb(req)} on ${chainName(req.chainId)} instead of ${chainName(plan.flowChain)}`,
          summary: `The wallet was on ${chainName(req.chainId)} and the dApp asked it to send the transaction there without switching first. On a real wallet this goes to the wrong network and can lose funds.`,
          expected: `Ask the wallet to switch to ${chainName(plan.flowChain)} before sending.`,
          actual: `eth_sendTransaction arrived with the wallet on chain ${req.chainId}.`,
          stepIndex: ctx.index,
          evidence: { buttonLabel: ctx.pending.buttonLabel, walletAsked: `eth_sendTransaction on chain ${req.chainId}` },
        });
        state.stoppedAtStep = ctx.index;
        return "reject";
      }
      return "default";
    },
    afterStep: async (ctx) => (state.stoppedAtStep === ctx.index ? "stop" : undefined),
  };
}

// ---------------------------------------------------------------- checks

/** After a rejection / failed send: is the UI stuck, and did it tell the user? */
async function recoveryChecks(edge: EdgeCaseId, session: EngineSession, replay: ReplayFlowResult, drafts: IssueDraft[], verb: string): Promise<void> {
  const ws = replay.walletSteps[0];
  const trigger = ws?.pending.buttonLabel ?? session.lastClickedLabel();
  await session.page.waitForTimeout(2_000);
  const rec = await inspectRecovery(session.page, trigger);
  const what = trigger ? `'${trigger}'` : "the request";
  const evidence = { buttonLabel: trigger, walletAsked: ws?.asked };

  if (edge === "low-gas" && !ws && !rec.message) {
    drafts.push({
      kind: "no-message",
      severity: "high",
      category: "wallet",
      title: `No message when there isn't enough ETH for gas`,
      summary: `With almost no ETH in the account the dApp never asked the wallet to sign and showed nothing the user could act on: ${replay.error}.`,
      expected: "Tell the user the account can't pay for gas.",
      actual: "No feedback on the page.",
      evidence,
    });
    return;
  }
  if (rec.stuckButton) {
    drafts.push({
      kind: "stuck-button",
      severity: "high",
      category: "wallet",
      title: `${capitalise(verb)} ${what} leaves the button stuck on '${rec.stuckButton}'`,
      summary: `After ${verb} the ${ws?.request.method ?? "wallet"} request the page kept a disabled '${rec.stuckButton}' button, so the user can't try again without reloading.`,
      expected: "Re-enable the button and show what happened.",
      actual: `The '${rec.stuckButton}' button is still disabled 2s later.`,
      stepIndex: ws?.stepIndex,
      evidence,
    });
  }
  if (!rec.message) {
    drafts.push({
      kind: "no-message",
      severity: "medium",
      category: "wallet",
      title: `No message after ${verb} ${what}`,
      summary: `After ${verb} the request the page shows no error or hint, so the user doesn't know the action didn't happen.`,
      expected: edge === "low-gas" ? "Explain that there isn't enough ETH for gas." : "Say the request was rejected and that the user can try again.",
      actual: "No feedback text found on the page.",
      stepIndex: ws?.stepIndex,
      evidence,
    });
  }
}

/** Checks that apply to every edge case. */
function commonChecks(edge: EdgeCaseId, plan: Plan, session: EngineSession, replay: ReplayFlowResult, drafts: IssueDraft[]): void {
  const pageErrors = session.console.filter((c) => c.level === "pageerror");
  if (pageErrors.length > 0) {
    drafts.push({
      kind: "page-error",
      severity: "medium",
      category: "ui",
      title: `Uncaught error on the page during ${edge === "happy" ? "the flow" : edgeLabel(edge)}`,
      summary: `The page threw ${pageErrors.length} uncaught error(s). First: ${pageErrors[0]!.text}`,
      actual: pageErrors[0]!.text,
      evidence: { console: pageErrors.slice(0, 10) },
    });
  }
  for (const ws of replay.walletSteps) {
    if (ws.doubleSubmission) {
      drafts.push({
        kind: "double-submission",
        severity: "high",
        category: "wallet",
        title: `Clicking '${ws.pending.buttonLabel ?? "the button"}' sends two signing requests`,
        summary: `One click produced two ${ws.request.method} requests (${ws.asked}). A user who approves both pays twice.`,
        expected: "One click, one request; disable the button while the first is pending.",
        actual: `Two requests arrived from the same click.`,
        stepIndex: ws.stepIndex,
        evidence: { buttonLabel: ws.pending.buttonLabel, walletAsked: ws.asked },
      });
    }
    if (edge === "happy" && ws.request.method === "eth_sendTransaction" && ws.request.outcome === "approved" && ws.request.chainId !== plan.flowChain) {
      drafts.push({
        kind: "wrong-chain-tx",
        severity: "critical",
        category: "wallet",
        title: `Sends ${requestVerb(ws.request)} on ${chainName(ws.request.chainId)} instead of ${chainName(plan.flowChain)}`,
        summary: `The transaction went out on chain ${ws.request.chainId} although the flow is for ${chainName(plan.flowChain)}.`,
        stepIndex: ws.stepIndex,
        evidence: { walletAsked: ws.asked },
      });
    }
  }
}

/** A page that went blank after the edge case hit is a problem whatever the flow says. */
async function blankCheck(edge: EdgeCaseId, session: EngineSession, replay: ReplayFlowResult, drafts: IssueDraft[]): Promise<void> {
  if (replay.completed) return;
  const rec = await inspectRecovery(session.page);
  if (rec.blank) {
    drafts.push({
      kind: "blank-page",
      severity: "high",
      category: "ui",
      title: `The page goes blank during ${edge === "happy" ? "the flow" : edgeLabel(edge)}`,
      summary: "After the edge case hit, the page shows almost nothing: no text and no controls the user could use.",
      expected: "Keep the page usable and show what happened.",
      actual: "An empty page.",
    });
  }
}

async function askJudge(judge: RecoveryJudge, session: EngineSession, edge: EdgeCaseId, expected: string, drafts: IssueDraft[], screenshot: string | undefined, artifactsDir: string): Promise<void> {
  if (!screenshot) return;
  try {
    const data = (await readFile(path.join(artifactsDir, screenshot))).toString("base64");
    const pageText = await session.page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const verdict = await judge.judge({ edgeCase: edge, expected, screenshot: { data, mediaType: "image/png" }, pageText: pageText.slice(0, 6000) });
    if (!verdict.ok) {
      drafts.push({
        kind: "recovery-judge",
        severity: "medium",
        category: "ui",
        title: `The page doesn't explain what happened after ${edgeLabel(edge)}`,
        summary: verdict.explanation,
        expected,
        unverified: true,
      });
    }
  } catch {
    /* the judge is optional */
  }
}

// ---------------------------------------------------------------- helpers

/** Account B gets the same token balance as A (from the happy run's approval token) so it can do the flow too. */
async function giveTokensLikeA(plan: Plan, chains: ChainController, wallet: Wallet): Promise<void> {
  if (!plan.approval || chains.mode(plan.flowChain) !== "fork") return;
  try {
    const client = chains.client(plan.flowChain);
    const balance = await client.readContract({ address: plan.approval.token, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet.accounts.A] });
    if (balance > 0n) await chains.dealErc20(plan.flowChain, plan.approval.token, wallet.accounts.B, balance);
  } catch {
    /* best effort */
  }
}

/** Set the account's allowance for the spender directly on the fork, signed with the account's own key. */
async function setAllowance(chains: ChainController, plan: Plan, wallet: Wallet, approval: ApprovalInfo, amount: bigint): Promise<void> {
  const key = plan.accounts[plan.account] as ViemHex;
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== wallet.accounts[plan.account].toLowerCase()) throw new Error("account key mismatch");
  const client = createWalletClient({ account, transport: http(chains.rpcUrl(plan.flowChain)) });
  const chain = { id: plan.flowChain, name: chainName(plan.flowChain), nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [chains.rpcUrl(plan.flowChain)] } } };
  const hash = await client.sendTransaction({
    chain,
    to: approval.token,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [approval.spender, amount] }),
  });
  await chains.client(plan.flowChain).waitForTransactionReceipt({ hash, timeout: 20_000 });
}

async function waitForQueuedSign(wallet: Wallet, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const queued = wallet.peekSigns()[0];
    if (queued) return queued;
    await new Promise((r) => setTimeout(r, 150));
  }
  return undefined;
}

/** The address a signing request names as the signer, if any. */
function requestSigner(req: WalletRequest): string | undefined {
  const p = Array.isArray(req.params) ? req.params : [];
  let v: unknown;
  if (req.method === "eth_sendTransaction" || req.method === "eth_signTransaction") v = (p[0] as { from?: string } | undefined)?.from;
  else if (req.method === "personal_sign") v = p[1];
  else if (req.method === "eth_sign" || req.method.startsWith("eth_signTypedData")) v = p[0];
  else if (req.method === "wallet_sendCalls") v = (p[0] as { from?: string } | undefined)?.from;
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : undefined;
}

function requestVerb(req: WalletRequest): string {
  const decoded = decodeBuiltin(req);
  if (decoded.kind === "transaction") return decoded.functionName ? `the ${decoded.functionName} transaction` : "the transaction";
  return decoded.kind === "typedData" ? "the typed-data signature" : "the message signature";
}

function walletName(id: WalletProfileId): string {
  return { metamask: "MetaMask", rabby: "Rabby", coinbase: "Coinbase Wallet" }[id];
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
