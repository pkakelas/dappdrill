import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget, ReplayScript, describeStep } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { Recorder, browserTools } from "../../src/agent/tools.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession, type EngineSession } from "../../src/browser/session.js";
import { replayScript } from "../../src/replay/replay.js";
import { ACCOUNTS, CHAIN_ID, startBareChain, startFixture, type Fixture } from "../runtime/fixture.js";

const OTHER = 4242;

let fx: Fixture;
let other: Awaited<ReturnType<typeof startBareChain>>;
let chains: ChainController;
let artifactsDir: string;

beforeAll(async () => {
  fx = await startFixture();
  other = await startBareChain(OTHER);
  chains = startChains(
    [
      { id: CHAIN_ID, rpcUrl: fx.rpcUrl },
      { id: OTHER, rpcUrl: other.rpcUrl },
    ],
    {},
  );
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-refuse-"));
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await other?.close();
  await fx?.close();
});

async function open(): Promise<EngineSession> {
  const target = DrillTarget.parse({
    url: fx.pageUrl(),
    chains: [
      { id: CHAIN_ID, rpcUrl: fx.rpcUrl },
      { id: OTHER, rpcUrl: other.rpcUrl },
    ],
    accounts: ACCOUNTS,
  });
  const session = await createSession(target, chains, { artifactsDir, sink: async () => {}, video: false });
  await session.page.goto(fx.pageUrl(), { waitUntil: "domcontentloaded" });
  return session;
}

const script = (steps: unknown[]) => ReplayScript.parse({ id: "refuse", name: "Refuse", startUrl: fx.pageUrl(), steps });
const connect = [
  { kind: "click", target: { role: "button", name: "Connect wallet" } },
  { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true } },
];
/** What the page gets back when it asks the wallet to switch to the other chain. */
const askSwitch = (session: EngineSession) =>
  session.page.evaluate(
    async (chainId) => {
      try {
        return await (window as any).ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
      } catch (e: any) {
        return e.code as number;
      }
    },
    `0x${OTHER.toString(16)}`,
  );

describe("refusing a connection or a network switch", () => {
  it("answers the next request to connect as a user pressing Cancel, and only that one", async () => {
    const session = await open();
    try {
      const refused = await replayScript(session, script([{ kind: "refuse", what: "connect" }, ...connect]), { here: true });
      expect(refused.error).toBeUndefined();
      expect(refused.completed).toBe(true);
      expect(session.wallet.requests().find((r) => r.method === "eth_requestAccounts")).toMatchObject({ outcome: "rejected" });
      expect(await session.page.locator("#error").textContent()).toContain("Connect failed");
      expect(await session.page.locator("#account").textContent()).toBe("not connected");
      expect(session.wallet.refusing("connect")).toBe(false);

      const again = await replayScript(session, script(connect), { here: true });
      expect(again.error).toBeUndefined();
      await expect.poll(() => session.page.locator("#account").textContent()).toContain(session.wallet.address());
    } finally {
      await session.close();
    }
  }, 60_000);

  it("refuses one network switch, and approves the one after it", async () => {
    const session = await open();
    try {
      session.wallet.refuseNext("switch");
      // Asking for the chain the wallet is on changes nothing, so there is nothing to refuse yet.
      expect(await session.page.evaluate((chainId) => (window as any).ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] }), `0x${CHAIN_ID.toString(16)}`)).toBeNull();
      expect(session.wallet.refusing("switch")).toBe(true);
      expect(await askSwitch(session)).toBe(4001);
      expect(session.wallet.chainId()).toBe(CHAIN_ID);
      expect(session.wallet.requests().at(-1)).toMatchObject({ kind: "switch", outcome: "rejected" });
      expect(await askSwitch(session)).toBeNull();
      expect(session.wallet.chainId()).toBe(OTHER);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("doesn't pass when the app never asked, and leaves no refusal behind", async () => {
    const session = await open();
    try {
      const r = await replayScript(session, script([{ kind: "refuse", what: "switch" }]), { here: true });
      expect(r.completed).toBe(false);
      expect(r.error).toBe("Step 1 (Refuse the next network switch in the wallet): The app didn't ask the wallet to switch network, so there was nothing to refuse");
      expect(r.steps.map((s) => s.status)).toEqual(["fail"]);
      expect(session.wallet.refusing("switch")).toBe(false);
      expect(await askSwitch(session)).toBeNull();
    } finally {
      await session.close();
    }
  }, 60_000);

  it("is recorded as a step of its own when a model asks for it", async () => {
    const session = await open();
    try {
      const recorder = new Recorder(session);
      recorder.start();
      const tool = browserTools({ session, recorder }).find((t) => t.name === "wallet_refuse_next")!;
      await tool.handler({ what: "connect" });
      const steps = recorder.take();
      expect(steps).toEqual([{ kind: "refuse", what: "connect" }]);
      expect(describeStep(steps[0]!)).toBe("Refuse the next connection in the wallet");
      expect(session.wallet.refusing("connect")).toBe(true);
    } finally {
      await session.close();
    }
  }, 60_000);
});
