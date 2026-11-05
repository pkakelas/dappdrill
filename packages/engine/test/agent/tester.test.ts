import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step, TestSpec } from "@dappdrill/core";
import { judgeExpected, runStep, type StepDeps } from "../../src/agent/tester.js";
import { createStubSession, type StubSession } from "./fixture/session.js";
import { refOf, scriptedRuns } from "./fixture/scripted-llm.js";

let session: StubSession;
beforeAll(async () => {
  session = await createStubSession();
});
afterAll(async () => {
  await session?.close();
});

const spec = (steps: TestSpec["steps"]): TestSpec => ({
  id: "t1",
  name: "Deposit USDC",
  goal: "Deposit a little USDC into the vault.",
  expected: "The vault shows the deposit.",
  startPath: "/vault.html",
  steps,
});

async function open() {
  await session.page.goto(`${session.baseUrl}/vault.html`);
}

function deps(over: Partial<StepDeps>): StepDeps {
  return { session, fast: scriptedRuns([]), replay: async () => ({ ok: true }), ...over };
}

describe("runStep", () => {
  it("replays cached actions without the model", async () => {
    await open();
    const fast = scriptedRuns([[{ tool: "step_done", input: { ok: false, reason: "should not run" } }]]);
    const cached: Step[] = [{ kind: "click", target: { role: "button", name: "Connect wallet" } }];
    let replayed: Step[] | undefined;
    const out = await runStep(deps({ fast, replay: async (a) => ((replayed = a), { ok: true }) }), spec([{ text: "Connect the wallet", actions: cached }]), 0);
    expect(out).toMatchObject({ ok: true, via: "cache", did: ['Click "Connect wallet"'] });
    expect(replayed).toEqual(cached);
    expect(fast.results).toHaveLength(0);
  });

  it("lets the model do a step and records its actions for next time", async () => {
    await open();
    const fast = scriptedRuns([
      [
        { tool: "look" },
        (_l, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Connect wallet") } }),
        { tool: "expect_text", input: { text: "Connect a wallet" } },
        { tool: "step_done", input: { ok: true, reason: "The wallet picker is open." } },
      ],
    ]);
    const out = await runStep(deps({ fast }), spec([{ text: "Open the wallet picker" }]), 0);
    expect(out.ok).toBe(true);
    expect(out.via).toBe("agent");
    expect(out.actions?.map((a) => a.kind)).toEqual(["click", "expect"]);
    expect(out.did).toEqual(['Click "Connect wallet"', 'See "Connect a wallet"']);
  });

  it("falls back to the model when the cache breaks, and tells it why", async () => {
    await open();
    const fast = scriptedRuns([[{ tool: "step_done", input: { ok: true, reason: "Already there." } }]]);
    const prompts: string[] = [];
    const runAgent = fast.runAgent.bind(fast);
    fast.runAgent = (o) => (prompts.push(o.prompt), runAgent(o));
    const out = await runStep(
      deps({ fast, replay: async () => ({ ok: false, error: "button gone" }) }),
      spec([{ text: "Open the vault", actions: [{ kind: "click", target: { text: "Old" } }] }]),
      0,
    );
    expect(out).toMatchObject({ ok: true, via: "agent", actions: [] });
    expect(prompts[0]).toContain("replaying them failed now: button gone");
  });

  it("calls a wrong balance Couldn't run only when a backend was asked about the wallet", async () => {
    const blind = { tool: "step_done", input: { ok: false, cause: "fork", reason: "The page shows 0 ETH." } };
    await open();
    const out = await runStep(deps({ fast: scriptedRuns([[blind]]), walletBackends: () => ["api.example.com"] }), spec([{ text: "Click Supply" }]), 0);
    expect(out).toMatchObject({ ok: false, stuck: true });
    expect(out.note).toContain("api.example.com");

    await open();
    const noBackend = await runStep(deps({ fast: scriptedRuns([[blind]]), walletBackends: () => [] }), spec([{ text: "Click Supply" }]), 0);
    expect(noBackend).toMatchObject({ ok: false, note: "The page shows 0 ETH." });
    expect(noBackend.stuck).toBeUndefined();
  });

  it("doesn't take the fast model's word that the app is at fault on a step that never worked", async () => {
    await open();
    const fast = scriptedRuns([[{ tool: "step_done", input: { ok: false, cause: "app", reason: "There is no Repay button." } }]]);
    const strong = scriptedRuns([[{ tool: "step_done", input: { ok: true, reason: "Found it." } }]]);
    const out = await runStep(deps({ fast, strong }), spec([{ text: "Click Repay" }]), 0);
    expect(out.ok).toBe(true);
    expect(strong.results).toHaveLength(1);
  });

  it("hands an unsure step to the stronger model once", async () => {
    await open();
    const fast = scriptedRuns([[{ tool: "step_done", input: { ok: false, cause: "unsure", reason: "No idea where deposit is." } }]]);
    const strong = scriptedRuns([[{ tool: "step_done", input: { ok: false, cause: "app", reason: "Deposit is disabled." } }]]);
    const out = await runStep(deps({ fast, strong }), spec([{ text: "Deposit 5 USDC" }]), 0);
    expect(out).toMatchObject({ ok: false, note: "Deposit is disabled." });
    expect(out.actions).toBeUndefined();
    expect(strong.results).toHaveLength(1);
  });

  describe("when a click never lands", () => {
    // In the snapshot, but something sits on top of it, so Playwright's click times out.
    async function blockedButton() {
      await session.page.setContent(`
        <button id="go" style="position:fixed;top:0;left:0;width:100px;height:40px">Go</button>
        <div style="position:fixed;top:0;left:0;width:100px;height:40px;z-index:9"></div>
        <button id="ok" style="margin-top:100px">Other</button>`);
    }
    const clickGo = (_l: string, page: string) => ({ tool: "click", input: { ref: refOf(page, "button", "Go") } });
    const blame = { tool: "step_done", input: { ok: false, cause: "app", reason: "An overlay covers the button." } };

    it("doesn't take the fast model's word that the app is at fault", async () => {
      await blockedButton();
      const fast = scriptedRuns([[{ tool: "look" }, clickGo, blame]]);
      const strong = scriptedRuns([[{ tool: "step_done", input: { ok: false, cause: "unsure", reason: "Can't reach it." } }]]);
      const out = await runStep(deps({ fast, strong }), spec([{ text: "Press Go" }]), 0);
      expect(strong.results).toHaveLength(1);
      expect(out).toMatchObject({ ok: false, stuck: true, note: "Couldn't click “Go”, so this step didn't finish." });
    }, 20_000);

    it("explains the failed click to the model", async () => {
      await blockedButton();
      const fast = scriptedRuns([[{ tool: "look" }, clickGo, blame]]);
      await runStep(deps({ fast }), spec([{ text: "Press Go" }]), 0);
      expect(fast.results[1]).toContain("This says nothing about the app");
    }, 20_000);

    it("trusts the acting model when it sees the app in the way", async () => {
      await blockedButton();
      const fast = scriptedRuns([[{ tool: "look" }, clickGo, blame]]);
      const strong = scriptedRuns([[{ tool: "step_done", input: { ok: false, cause: "app", reason: "A banner stays over the button." } }]]);
      const out = await runStep(deps({ fast, strong }), spec([{ text: "Press Go" }]), 0);
      expect(out).toMatchObject({ ok: false, note: "A banner stays over the button." });
      expect(out.stuck).toBeUndefined();
    }, 20_000);

    it("clears once a later click lands", async () => {
      await blockedButton();
      const fast = scriptedRuns([
        [
          { tool: "look" },
          clickGo,
          (_l, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Other") } }),
          { tool: "step_done", input: { ok: false, cause: "app", reason: "Nothing happened." } },
        ],
      ]);
      const out = await runStep(deps({ fast }), spec([{ text: "Press Go" }]), 0);
      expect(out).toMatchObject({ ok: false, note: "Nothing happened." });
      expect(out.stuck).toBeUndefined();
    }, 20_000);
  });

  it("refuses an expect_text that isn't on the page", async () => {
    await open();
    const fast = scriptedRuns([
      [
        { tool: "expect_text", input: { text: "Order filled" } },
        { tool: "step_done", input: { ok: false, cause: "app", reason: "No confirmation." } },
      ],
    ]);
    const out = await runStep(deps({ fast }), spec([{ text: "Check the order filled" }]), 0);
    expect(fast.results[0]).toContain("is not visible");
    expect(out.ok).toBe(false);
  });
});

describe("judgeExpected", () => {
  it("asks the model even when an old proof text still shows", async () => {
    await open();
    const llm = { ...scriptedRuns([]), structured: async () => ({ ok: false, reason: "Nothing was deposited." }) } as unknown as StepDeps["fast"];
    const out = await judgeExpected(session, llm, { ...spec([{ text: "Connect the wallet" }]), proof: "Connect wallet" });
    expect(out).toEqual({ ok: false, reason: "Nothing was deposited." });
  });
});
