import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget, ReplayScript, type Step } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession, type EngineSession } from "../../src/browser/session.js";
import { replayScript } from "../../src/replay/replay.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "../runtime/fixture.js";

let fx: Fixture;
let chains: ChainController;
let artifactsDir: string;

beforeAll(async () => {
  fx = await startFixture();
  chains = startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], {});
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-optional-"));
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

async function open(): Promise<EngineSession> {
  const target = DrillTarget.parse({ url: fx.pageUrl(), chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS });
  return createSession(target, chains, { artifactsDir, sink: async () => {}, video: false });
}

const script = (steps: unknown[]) => ReplayScript.parse({ id: "optional", name: "Optional steps", startUrl: fx.pageUrl(), steps });
const connect: Step[] = [
  { kind: "click", target: { role: "button", name: "Connect wallet" } },
  { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true } },
];
const deposit: Step[] = [
  { kind: "fill", target: { testId: "amount" }, value: "5" },
  { kind: "click", target: { role: "button", name: "Deposit" } },
];

describe("optional steps", () => {
  it("passes over a prompt that didn't show and the wallet request it would have asked for, and goes on", async () => {
    const session = await open();
    try {
      const r = await replayScript(
        session,
        script([
          { kind: "click", target: { role: "button", name: "Accept the terms" }, optional: true },
          { kind: "wallet", respond: "approve" },
          ...connect,
          { kind: "expect", assert: { type: "visible", text: "Deposit" } },
        ]),
      );
      expect(r.error).toBeUndefined();
      expect(r.completed).toBe(true);
      expect(r.steps.map((s) => s.status)).toEqual(["skipped", "skipped", "pass", "pass", "pass"]);
      expect(r.steps[0]!.error).toMatch(/Could not find/);
      expect(r.steps[1]!.error).toBe("the optional step that asks for it didn't show");
      // It didn't wait as long as it would for a step that must be there.
      expect(r.steps[0]!.durationMs).toBeLessThan(15_000);
    } finally {
      await session.close();
    }
  }, 90_000);

  it("does an optional step that is there", async () => {
    const session = await open();
    try {
      const r = await replayScript(session, script(connect.map((s) => ({ ...s, optional: true }))));
      expect(r.steps.map((s) => s.status)).toEqual(["pass", "pass"]);
    } finally {
      await session.close();
    }
  }, 90_000);

  it("passes over an optional wallet step when the app asks for nothing", async () => {
    const session = await open();
    try {
      const r = await replayScript(session, script([...connect, { kind: "wallet", respond: "approve", optional: true }, { kind: "fill", target: { testId: "amount" }, value: "5" }]));
      expect(r.error).toBeUndefined();
      expect(r.completed).toBe(true);
      expect(r.steps.map((s) => s.status)).toEqual(["pass", "pass", "skipped", "pass"]);
      expect(r.walletRequests.filter((w) => w.kind === "sign")).toEqual([]);
    } finally {
      await session.close();
    }
  }, 90_000);

  it("answers the request when the app does ask at an optional wallet step", async () => {
    const session = await open();
    try {
      const r = await replayScript(session, script([...connect, ...deposit, { kind: "wallet", respond: "approve", optional: true }, { kind: "wallet", respond: "approve", optional: true }, { kind: "expect", assert: { type: "visible", text: "Deposited 5 TUSD" } }]));
      expect(r.error).toBeUndefined();
      expect(r.steps.map((s) => s.status)).toEqual(["pass", "pass", "pass", "pass", "pass", "pass", "pass"]);
      expect(r.walletSteps.map((w) => w.request.outcome)).toEqual(["approved", "approved"]);
    } finally {
      await session.close();
    }
  }, 90_000);

  it("holds a request that came to its step: one that doesn't match fails, optional or not", async () => {
    const session = await open();
    try {
      const r = await replayScript(session, script([...connect, ...deposit, { kind: "wallet", respond: "approve", optional: true, expect: { kind: "transaction", functionName: "withdraw" } }, { kind: "expect", assert: { type: "visible", text: "Deposited 5 TUSD" } }]));
      expect(r.completed).toBe(false);
      expect(r.steps.map((s) => s.status)).toEqual(["pass", "pass", "pass", "pass", "fail"]);
      expect(r.error).toMatch(/The wallet request doesn't match the test/);
      expect(r.walletSteps[0]!.request.outcome).toBe("rejected");
    } finally {
      await session.close();
    }
  }, 90_000);
});
