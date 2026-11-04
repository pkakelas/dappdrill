import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Step, TestSpec } from "@dappdrill/core";
import { runStep, type StepDeps } from "../../src/agent/tester.js";
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

  it("hands an unsure step to the stronger model once", async () => {
    await open();
    const fast = scriptedRuns([[{ tool: "step_done", input: { ok: false, cause: "unsure", reason: "No idea where deposit is." } }]]);
    const strong = scriptedRuns([[{ tool: "step_done", input: { ok: false, cause: "app", reason: "Deposit is disabled." } }]]);
    const out = await runStep(deps({ fast, strong }), spec([{ text: "Deposit 5 USDC" }]), 0);
    expect(out).toMatchObject({ ok: false, note: "Deposit is disabled." });
    expect(out.actions).toBeUndefined();
    expect(strong.results).toHaveLength(1);
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
