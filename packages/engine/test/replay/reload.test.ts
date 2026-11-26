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
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "../runtime/fixture.js";

let fx: Fixture;
let chains: ChainController;
let artifactsDir: string;

beforeAll(async () => {
  fx = await startFixture();
  chains = startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], {});
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-reload-"));
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

async function open(): Promise<EngineSession> {
  const target = DrillTarget.parse({ url: fx.pageUrl(), chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS });
  const session = await createSession(target, chains, { artifactsDir, sink: async () => {}, video: false });
  await session.page.goto(fx.pageUrl(), { waitUntil: "domcontentloaded" });
  return session;
}

/** Something only this load of the page holds, so a reload shows as its loss. */
const mark = (session: EngineSession) => session.page.evaluate(() => void ((window as unknown as { kept?: boolean }).kept = true));
const marked = (session: EngineSession) => session.page.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

describe("reload", () => {
  it("records opening the address the page is already at as a reload, with no address written down", async () => {
    const session = await open();
    try {
      const recorder = new Recorder(session);
      recorder.start();
      const goto = browserTools({ session, recorder }).find((t) => t.name === "goto")!;
      await mark(session);
      await goto.handler({ url: session.page.url() });
      expect(await marked(session)).toBe(false);
      const elsewhere = new URL(session.page.url());
      elsewhere.searchParams.set("tab", "history");
      await goto.handler({ url: elsewhere.href });
      const steps = recorder.take();
      expect(steps).toEqual([{ kind: "reload" }, { kind: "goto", url: elsewhere.pathname + elsewhere.search }]);
      expect(describeStep(steps[0]!)).toBe("Reload the page");
    } finally {
      await session.close();
    }
  });

  it("replays a reload on the page the test is on", async () => {
    const session = await open();
    try {
      await mark(session);
      const before = session.page.url();
      const r = await replayScript(session, ReplayScript.parse({ id: "reload", name: "Reload", startUrl: fx.pageUrl(), steps: [{ kind: "reload" }] }), { here: true });
      expect(r.error).toBeUndefined();
      expect(r.steps.map((s) => s.status)).toEqual(["pass"]);
      expect(await marked(session)).toBe(false);
      expect(session.page.url()).toBe(before);
    } finally {
      await session.close();
    }
  });
});
