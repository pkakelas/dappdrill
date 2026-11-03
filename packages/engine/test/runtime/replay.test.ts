import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { DrillTarget, type SigningReview } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession, type EngineSession } from "../../src/browser/session.js";
import { replayFlow } from "../../src/replay/replay.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "./fixture.js";
import { depositFlow } from "./flow.js";

let fx: Fixture;
let chains: ChainController;
let artifactsDir: string;

beforeAll(async () => {
  fx = await startFixture();
  chains = await startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" }], {});
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-replay-"));
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

async function open(bugs: string[] = []): Promise<EngineSession> {
  const url = fx.pageUrl(bugs);
  const target = DrillTarget.parse({ url, chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS });
  return createSession(target, chains, { artifactsDir, sink: async () => {}, video: false });
}

describe("replayFlow", () => {
  it("replays connect → approve → deposit and checks every wallet expectation", async () => {
    const session = await open();
    const snap = await chains.snapshot(CHAIN_ID);
    try {
      const flow = depositFlow(fx.pageUrl(), fx.token, fx.vault);
      // A stand-in reviewer: this test is about the replay, not the review.
      const reviewer = { review: async () => ({ id: "sgr_stub", verdict: "consistent", checks: [], approvals: [] }) as unknown as SigningReview };
      const r = await replayFlow(session, flow, { params: { amount: "7" }, reviewer, runId: "run_replay" });
      expect(r.error).toBeUndefined();
      // Signing issues find their edge case through the review's run.
      expect(r.signingReviews.map((s) => s.runId)).toEqual(["run_replay", "run_replay"]);
      expect(r.completed).toBe(true);
      expect(r.steps.map((s) => s.status)).toEqual(["pass", "pass", "pass", "pass", "pass", "pass", "pass"]);
      expect(r.walletSteps.map((w) => w.asked)).toEqual([
        `approve(${getAddress(fx.vault)}, 7000000) to ${fx.token.toLowerCase()}`,
        `deposit(7000000) to ${fx.vault.toLowerCase()}`,
      ]);
      expect(r.walletSteps[0]!.pending.buttonLabel).toBe("Deposit");
      expect(r.walletSteps.every((w) => w.expectationProblems.length === 0 && !w.doubleSubmission)).toBe(true);
      expect(r.walletRequests.filter((w) => w.kind === "sign").every((w) => w.outcome === "approved")).toBe(true);
    } finally {
      await session.close();
      await chains.revert(CHAIN_ID, snap);
    }
  }, 90_000);

  it("fails the wallet step when the dApp asks for an unlimited approval", async () => {
    const session = await open(["unlimited"]);
    const snap = await chains.snapshot(CHAIN_ID);
    try {
      const r = await replayFlow(session, depositFlow(fx.pageUrl(["unlimited"]), fx.token, fx.vault));
      expect(r.completed).toBe(false);
      expect(r.steps[4]!.status).toBe("fail");
      expect(r.error).toMatch(/The wallet request doesn't match the flow: the approval is unlimited; amount should be 5/);
      // the mismatching request was rejected, not signed
      expect(r.walletSteps[0]!.request.outcome).toBe("rejected");
      expect(r.steps[4]!.screenshot).toMatch(/step4-fail\.png$/);
    } finally {
      await session.close();
      await chains.revert(CHAIN_ID, snap);
    }
  }, 90_000);

  it("honours hooks: reject at a wallet step and stop", async () => {
    const session = await open();
    const snap = await chains.snapshot(CHAIN_ID);
    try {
      const r = await replayFlow(session, depositFlow(fx.pageUrl(), fx.token, fx.vault), {
        hooks: {
          respond: async (ctx) => (ctx.signIndex === 0 ? "reject" : "default"),
          afterStep: async (ctx) => (ctx.step.kind === "wallet" ? "stop" : undefined),
        },
      });
      expect(r.stoppedByHook).toBe(true);
      expect(r.completed).toBe(false);
      expect(r.steps).toHaveLength(5);
      expect(r.walletSteps[0]!.response).toBe("reject");
      await session.page.getByText("You rejected the transaction").waitFor({ timeout: 5_000 });
    } finally {
      await session.close();
      await chains.revert(CHAIN_ID, snap);
    }
  }, 90_000);

  it("skips an optional one-time prompt that doesn't show, and the signature it would ask for", async () => {
    const session = await open();
    const snap = await chains.snapshot(CHAIN_ID);
    try {
      const base = depositFlow(fx.pageUrl(), fx.token, fx.vault);
      const terms = [
        { kind: "click", target: { role: "button", name: "Accept terms" }, optional: true },
        { kind: "wallet", respond: "approve", expect: { kind: "typedData" } },
      ] as const;
      const flow = { ...base, steps: [...base.steps.slice(0, 2), ...terms, ...base.steps.slice(2)] };
      const t0 = Date.now();
      const r = await replayFlow(session, flow);
      expect(r.completed).toBe(true);
      expect(r.steps.map((s) => s.status)).toEqual(["pass", "pass", "skipped", "skipped", "pass", "pass", "pass", "pass", "pass"]);
      expect(r.walletSteps).toHaveLength(2);
      expect(Date.now() - t0).toBeLessThan(40_000);
    } finally {
      await session.close();
      await chains.revert(CHAIN_ID, snap);
    }
  }, 90_000);

  it("reports a missing element plainly", async () => {
    const session = await open();
    try {
      const flow = depositFlow(fx.pageUrl(), fx.token, fx.vault, {
        steps: [{ kind: "click", target: { role: "button", name: "Withdraw everything" } }],
      });
      const r = await replayFlow(session, flow, { stepTimeoutMs: 2_000 });
      expect(r.error).toMatch(/^Step 1 \(Click "Withdraw everything"\): Could not find/);
    } finally {
      await session.close();
    }
  }, 60_000);
});
