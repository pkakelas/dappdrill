/**
 * A fake engine with the same four functions as src/api.ts. It drives no browser and
 * no chain: it streams a realistic event sequence (stages, logs, frames, flows, wallet
 * requests, signing reviews of every verdict, issues of every severity, a run matrix,
 * cost) so the worker, the CLI and the web app can be built and tested without one.
 *
 * Selected with DAPPDRILL_FAKE_ENGINE=1. DAPPDRILL_FAKE_DELAY_MS sets the pace (default 100).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ScanReport,
  newId,
  nowIso,
  type ChainConfig,
  type DrillEvent,
  type DrillEventSink,
  type DrillTarget,
  type EdgeCaseId,
  type Flow,
  type FlowRun,
  type Issue,
  type ReplayOptions,
  type ScanOptions,
  type SigningReview,
  type StepResult,
  type WalletRequest,
} from "@dappdrill/core";
import type * as api from "../api.js";
import { ACCOUNT_A, PAGES, type Baselines, RENAMED, discoveredFlows, makeIssue, missingStepIndex, outcomeFor, reviewsFor } from "./fixtures.js";
import { stripedPng } from "./png.js";

export interface Engine {
  scan: typeof api.scan;
  replay: typeof api.replay;
  describeFlow: typeof api.describeFlow;
  repairFlow: typeof api.repairFlow;
}

const COLOURS: [number, number, number][] = [
  [240, 240, 236],
  [220, 226, 240],
  [236, 222, 214],
  [214, 236, 222],
];

class Pacer {
  private frames = 0;
  constructor(
    private readonly artifactsDir: string,
    private readonly sink: DrillEventSink,
    private readonly signal?: AbortSignal,
  ) {}

  emit(event: DrillEvent) {
    return this.sink(event);
  }

  log(message: string, level: "info" | "warn" | "error" = "info") {
    return this.emit({ type: "log", level, message, at: nowIso() });
  }

  /** Waits a beat; throws an AbortError when the caller stops us. */
  async beat(n = 1) {
    this.signal?.throwIfAborted();
    await sleep(n * Number(process.env.DAPPDRILL_FAKE_DELAY_MS ?? 100), undefined, { signal: this.signal });
  }

  async png(rel: string, colour = COLOURS[this.frames % COLOURS.length]!): Promise<string> {
    const abs = join(this.artifactsDir, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, stripedPng(320, 200, colour));
    return rel;
  }

  async frame(url: string) {
    this.frames++;
    const path = await this.png(`frames/${String(this.frames).padStart(3, "0")}.png`);
    await this.emit({ type: "frame", path, url, at: nowIso() });
  }
}

const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

function resolveChains(target: DrillTarget): ChainConfig[] {
  const chains = target.chains.length > 0 ? target.chains : [{ id: 8453, name: "Base", rpcUrl: "https://base-rpc.publicnode.com", mode: "fork" as const }];
  return chains.map((c) => ({ ...c, forkBlock: c.forkBlock ?? "23456789" }));
}

interface MatrixResult {
  runs: FlowRun[];
  issues: Issue[];
  signingReviews: SigningReview[];
}

/** Runs every flow under every edge case; `replay` mode applies the site's later UI change. */
async function runMatrix(
  p: Pacer,
  flows: Flow[],
  edgeCases: EdgeCaseId[],
  chains: ChainConfig[],
  baselines: Baselines,
  mode: "scan" | "replay",
  variationId?: string,
): Promise<MatrixResult> {
  const out: MatrixResult = { runs: [], issues: [], signingReviews: [] };
  const forkBlocks = Object.fromEntries(chains.map((c) => [String(c.id), c.forkBlock ?? "0"]));
  for (const flow of flows) {
    await p.emit({ type: "flow-status", flowId: flow.id, status: "running" });
    let flowIssue = false;
    let flowFailed = false;
    let brokenStepReported = false;
    for (const edgeCase of edgeCases) {
      await p.beat();
      const runId = newId("run");
      const startedAt = nowIso();
      const missing = mode === "replay" ? missingStepIndex(flow) : -1;
      const canned = outcomeFor(flow, edgeCase);
      const run: FlowRun = {
        id: runId,
        flowId: flow.id,
        edgeCase,
        variationId,
        status: canned.status,
        reason: canned.reason,
        steps: [],
        walletRequests: [],
        signingReviewIds: [],
        issueIds: [],
        console: [],
        rpc: [{ chainId: chains[0]?.id, method: "eth_blockNumber", via: "page", durationMs: edgeCase === "slow-rpc" ? 4012 : 18, at: startedAt }],
        forkBlocks,
        mode: "fork",
        startedAt,
        finishedAt: startedAt,
      };
      if (canned.status === "skipped") {
        run.finishedAt = nowIso();
        out.runs.push(run);
        await p.emit({ type: "run", run });
        continue;
      }

      // Steps: fail at the renamed button (replay) or at the first wallet step (failing edge case).
      const failAt = missing >= 0 ? missing : canned.status === "fail" ? flow.steps.findIndex((s) => s.kind === "wallet") + 1 : -1;
      const steps: StepResult[] = flow.steps.map((step, index) => {
        if (failAt >= 0 && index > failAt) return { index, status: "skipped", durationMs: 0 };
        if (index === failAt) {
          return {
            index,
            status: "fail",
            durationMs: 10_000,
            error: missing >= 0 ? `No element matches role=button name="${RENAMED.from}"` : `Timed out waiting for "${step.kind === "expect" && step.assert.type !== "url" ? step.assert.text : "the page"}"`,
          };
        }
        return { index, status: "pass", durationMs: 200 + index * 40 };
      });
      if (failAt >= 0) {
        const shot = await p.png(`runs/${runId}/step-${failAt}.png`, [236, 214, 210]);
        steps[failAt]!.screenshot = shot;
      }
      run.steps = steps;
      run.finalScreenshot = await p.png(`runs/${runId}/final.png`);
      await p.frame(flow.startUrl);

      // Wallet requests: connect always; signing requests for wallet steps that were reached.
      const at = nowIso();
      const requests: WalletRequest[] = [{ id: newId("req"), method: "eth_requestAccounts", params: [], chainId: flow.chainId ?? 8453, kind: "connect", at, outcome: "approved", result: [ACCOUNT_A] }];
      flow.steps.forEach((step, index) => {
        if (step.kind !== "wallet" || (failAt >= 0 && index > failAt)) return;
        const rejected = edgeCase === "reject";
        requests.push({
          id: newId("req"),
          method: step.expect?.kind === "typedData" ? "eth_signTypedData_v4" : "eth_sendTransaction",
          params: [{ from: ACCOUNT_A }],
          chainId: flow.chainId ?? 8453,
          from: ACCOUNT_A,
          kind: "sign",
          at,
          outcome: rejected ? "rejected" : "approved",
          error: rejected ? "User rejected the request. (4001)" : undefined,
          result: rejected ? undefined : `0x${"ab".repeat(32)}`,
        });
      });
      run.walletRequests = requests;
      for (const request of requests) await p.emit({ type: "wallet-request", request });

      // Signing reviews come from the happy path, where every request is approved.
      if (edgeCase === "happy" && missing < 0) {
        const reviews = reviewsFor(flow, runId, requests.filter((r) => r.kind === "sign").map((r) => r.id), baselines);
        for (const review of reviews) {
          review.ui.screenshot = run.finalScreenshot;
          run.signingReviewIds.push(review.id);
          out.signingReviews.push(review);
          await p.emit({ type: "signing-review", review });
        }
      }

      let issue: Issue | undefined;
      if (missing >= 0) {
        run.status = "fail";
        run.reason = `Step ${missing + 1} can't find the "${RENAMED.from}" button.`;
        if (!brokenStepReported) {
          brokenStepReported = true;
          issue = makeIssue(
            {
              severity: "high",
              category: "ui",
              title: `${flow.name} broke: "${RENAMED.from}" button is gone`,
              summary: `The saved flow clicks "${RENAMED.from}", which no longer exists on ${flow.startUrl}. The page now shows "${RENAMED.to}".`,
              expected: `A button named "${RENAMED.from}".`,
              actual: "No matching element after 10s.",
            },
            flow,
            edgeCase,
            runId,
            { stepIndex: missing },
          );
        }
      } else if (canned.issue) {
        const review = out.signingReviews.find((r) => r.runId === runId && r.verdict === "dangerous");
        issue = makeIssue(canned.issue, flow, edgeCase, runId, {
          stepIndex: failAt >= 0 ? failAt : undefined,
          evidence: {
            screenshot: failAt >= 0 ? steps[failAt]!.screenshot : run.finalScreenshot,
            signingReviewId: review?.id,
            buttonLabel: review?.ui.buttonLabel,
            walletAsked: review?.title,
            console: edgeCase === "reject" ? [{ level: "error", text: "Error: User rejected the request.", at }] : undefined,
          },
        });
      }
      if (issue) {
        run.issueIds.push(issue.id);
        out.issues.push(issue);
        await p.emit({ type: "issue", issue });
      }
      if (run.status === "fail") flowFailed = true;
      if (run.status === "issue") flowIssue = true;
      run.finishedAt = nowIso();
      out.runs.push(run);
      await p.emit({ type: "run", run });
    }
    await p.emit({ type: "flow-status", flowId: flow.id, status: flowFailed ? "failed" : flowIssue ? "issue" : "tested" });
  }
  return out;
}

export const scan: Engine["scan"] = async (target, options: ScanOptions, sink, signal) => {
  const p = new Pacer(options.artifactsDir, sink, signal);
  const startedAt = nowIso();
  const chains = resolveChains(target);
  const pages: { url: string; title?: string }[] = [];
  const flows: Flow[] = [];
  let matrix: MatrixResult = { runs: [], issues: [], signingReviews: [] };
  let cost = 0;
  const spend = async (usd: number) => {
    cost = Math.round((cost + usd) * 1000) / 1000;
    await p.emit({ type: "cost", usd: cost });
  };
  let stoppedEarly = false;
  try {
    await p.emit({ type: "stage", stage: "map", status: "running", progress: 0 });
    await p.log(`Opening ${target.url}`);
    await p.emit({ type: "chains", chains });
    await p.log(`Forked ${chains.map((c) => `${c.name ?? c.id} at block ${c.forkBlock}`).join(", ")}`);
    for (const [i, page] of PAGES.entries()) {
      await p.beat();
      const url = new URL(page.path, target.url).toString();
      pages.push({ url, title: page.title });
      await p.emit({ type: "page", url, title: page.title });
      await p.frame(url);
      await p.emit({ type: "stage", stage: "map", status: "running", progress: (i + 1) / PAGES.length });
    }
    await spend(0.04);
    await p.emit({ type: "stage", stage: "map", status: "done", progress: 1 });

    await p.emit({ type: "stage", stage: "flows", status: "running", progress: 0 });
    const found = discoveredFlows(target.url).slice(0, options.maxFlows ?? 8);
    for (const [i, flow] of found.entries()) {
      await p.beat(2);
      await p.log(`Found a flow: ${flow.name}`);
      flows.push(flow);
      await p.emit({ type: "flow", flow });
      await p.emit({ type: "flow-status", flowId: flow.id, status: "queued" });
      await spend(0.07);
      await p.emit({ type: "stage", stage: "flows", status: "running", progress: (i + 1) / found.length });
    }
    if (target.edgeCases.includes("failing-rpc")) await p.log("Some RPC calls are failing on purpose (failing-rpc)", "warn");
    await p.emit({ type: "stage", stage: "flows", status: "done", progress: 1 });

    await p.emit({ type: "stage", stage: "edge-cases", status: "running", progress: 0 });
    matrix = await runMatrix(p, flows, target.edgeCases, chains, options.baselines ?? {}, "scan");
    await p.emit({ type: "stage", stage: "edge-cases", status: "done", progress: 1 });

    await p.emit({ type: "stage", stage: "signing", status: "running", progress: 0 });
    await p.beat();
    await spend(0.05);
    await p.log(`Reviewed ${matrix.signingReviews.length} signing requests`);
    await p.emit({ type: "stage", stage: "signing", status: "done", progress: 1 });
  } catch (e) {
    if (!isAbort(e)) throw e;
    stoppedEarly = true;
    await p.log("Stopped", "warn");
  }
  return ScanReport.parse({
    url: target.url,
    startedAt,
    finishedAt: nowIso(),
    chains,
    pages,
    flows,
    ...matrix,
    costUsd: cost,
    stoppedEarly,
  });
};

export const replay: Engine["replay"] = async (target, flows, options: ReplayOptions, sink, signal) => {
  const p = new Pacer(options.artifactsDir, sink, signal);
  const chains = resolveChains(target);
  await p.log(`Replaying ${flows.length} flow(s) on ${target.url}`);
  try {
    return await runMatrix(p, flows, options.edgeCases ?? ["happy"], chains, options.baselines ?? {}, "replay", options.variation?.id);
  } catch (e) {
    if (!isAbort(e)) throw e;
    await p.log("Stopped", "warn");
    return { runs: [], issues: [], signingReviews: [] };
  }
};

export const describeFlow: Engine["describeFlow"] = async (target, description, options, sink) => {
  const p = new Pacer(options.artifactsDir, sink);
  await p.log(`Trying: ${description}`);
  await p.beat(2);
  await p.frame(target.url);
  const added = { kind: "expect" as const, assert: { type: "visible" as const, text: "Done" }, note: description };
  if (options.existing) {
    const flow: Flow = { ...options.existing, steps: [...options.existing.steps, added] };
    return { flow, explanation: `Added a check at the end: "${description}".` };
  }
  const flow: Flow = {
    id: newId("flw"),
    name: description.length > 48 ? `${description.slice(0, 47)}…` : description,
    origin: "described",
    startUrl: "/",
    params: [],
    steps: [
      { kind: "goto", url: "/" },
      { kind: "click", target: { role: "button", name: "Connect wallet" } },
      { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true } },
      added,
    ],
  };
  return { flow, explanation: `Recorded ${flow.steps.length} steps by doing it on the site.` };
};

export const repairFlow: Engine["repairFlow"] = async (target, flow, failed, options, sink) => {
  const p = new Pacer(options.artifactsDir, sink);
  const index = missingStepIndex(flow);
  await p.log(`Looking for a fix for ${flow.name} (run ${failed.id})`);
  await p.beat();
  if (index < 0) return null;
  const steps = flow.steps.map((s, i) => (i === index && "target" in s && s.target ? { ...s, target: { ...s.target, name: RENAMED.to } } : s));
  return {
    flow: { ...flow, steps },
    explanation: `The "${RENAMED.from}" button is now called "${RENAMED.to}". Step ${index + 1} now clicks "${RENAMED.to}".`,
  };
};

export const fakeEngine: Engine = { scan, replay, describeFlow, repairFlow };

export { loadEngine } from "./select.js";
