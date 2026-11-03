import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Flow, type FlowRun } from "@dappdrill/core";
import { recordDescribedFlow, type ReplayFn } from "../../src/agent/describe.js";
import { proposeRepair } from "../../src/agent/repair.js";
import { refOf, scriptedLlm } from "./fixture/scripted-llm.js";
import { createStubSession, type StubSession } from "./fixture/session.js";

vi.setConfig({ testTimeout: 60_000 });

let s: StubSession;
beforeAll(async () => {
  s = await createStubSession();
}, 60_000);
afterAll(async () => {
  await s?.close();
});

/** A toy replay: goto startUrl, then run click/fill/wallet steps with Playwright. Fails on a step whose target is missing. */
const toyReplay: ReplayFn = async (flow, { upToStep }) => {
  const steps = flow.steps.slice(0, upToStep ?? flow.steps.length);
  await s.page.goto(flow.startUrl);
  for (const [i, step] of steps.entries()) {
    try {
      if (step.kind === "click" || step.kind === "fill") {
        const t = step.target;
        const loc = t.role ? s.page.getByRole(t.role as "button", { name: t.name, exact: true }) : s.page.locator(t.css ?? "nope");
        if (step.kind === "click") await loc.click({ timeout: 1_000 });
        else await loc.fill(step.value.replace("{{amount}}", flow.params[0]?.default ?? ""), { timeout: 1_000 });
      } else if (step.kind === "wallet") {
        const p = await s.wallet.nextSign(3_000);
        await s.wallet.approve(p.request.id);
      } else if (step.kind === "expect" && step.assert.type === "visible") {
        await s.page.getByText(step.assert.text).waitFor({ timeout: 2_000 });
      }
    } catch (err) {
      return { ok: false, failedStep: i, error: (err as Error).message.split("\n")[0] };
    }
  }
  return { ok: true };
};

describe("recordDescribedFlow", () => {
  it("marks the clicks that connected the wallet as optional", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    await s.page.evaluate(() => sessionStorage.clear());
    await s.page.reload();
    const llm = scriptedLlm([
      { tool: "look" },
      { tool: "start_flow" },
      (_l, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Connect wallet") } }),
      (_l, page) => ({ tool: "click", input: { ref: refOf(page, "button", "MetaMask") } }),
      (_l, page) => ({ tool: "click", input: { ref: refOf(page, "link", "Vault") } }),
      { tool: "end_flow", input: { success: true, name: "Connect", successText: "Amount" } },
    ], "Connects.");
    const { flow } = await recordDescribedFlow(s, llm, "connect the wallet and open the vault");
    expect(flow.steps.map((st) => [st.kind, st.optional ?? false])).toEqual([
      ["click", true],
      ["click", true],
      ["click", false],
      ["expect", false],
    ]);
  });

  it("records the described flow with a name and explanation", async () => {
    await s.page.goto(`${s.baseUrl}/vault.html`);
    await s.page.evaluate(() => sessionStorage.setItem("account", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    await s.page.reload();
    const llm = scriptedLlm([
      { tool: "look" },
      { tool: "start_flow" },
      (_l, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Claim rewards") } }),
      { tool: "wallet_approve" },
      { tool: "end_flow", input: { success: true, name: "Claim rewards", successText: "Rewards claimed" } },
    ], "Claims the pending USDC rewards.");
    const { flow, explanation } = await recordDescribedFlow(s, llm, "claim my rewards");
    expect(explanation).toBe("Claims the pending USDC rewards.");
    expect(Flow.parse(flow)).toMatchObject({ name: "Claim rewards", origin: "described", startUrl: `${s.baseUrl}/vault.html`, params: [] });
    expect(flow.steps.map((st) => st.kind)).toEqual(["click", "wallet", "expect"]);
    expect(flow.steps[1]).toMatchObject({ kind: "wallet", expect: { functionName: "claim", to: "0x1111111111111111111111111111111111111111" } });
  });

  it("replays an existing flow up to a step and keeps that prefix", async () => {
    const existing: Flow = {
      id: "flow_x", name: "Deposit", origin: "described", startUrl: `${s.baseUrl}/vault.html`, chainId: 31337,
      params: [{ name: "amount", default: "1" }],
      steps: [
        { kind: "fill", target: { role: "textbox", name: "Amount" }, value: "{{amount}}" },
        { kind: "click", target: { role: "button", name: "Deposit" } },
        { kind: "wallet", respond: "approve" },
        { kind: "wallet", respond: "approve" },
      ],
    };
    const llm = scriptedLlm([
      { tool: "replay_existing", input: { upToStep: 1 } },
      (_l, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Withdraw") } }),
      { tool: "wallet_approve" },
      { tool: "end_flow", input: { success: true, name: "Withdraw", successText: "Withdrew 1 USDC" } },
    ]);
    const { flow } = await recordDescribedFlow(s, llm, "change it to withdraw instead", { existing, replay: toyReplay });
    expect(flow.id).toBe("flow_x");
    expect(flow.name).toBe("Withdraw");
    expect(flow.params).toEqual([{ name: "amount", default: "1" }]);
    expect(flow.steps.map((st) => st.kind)).toEqual(["fill", "click", "wallet", "expect"]);
    expect(flow.steps[1]).toMatchObject({ target: { name: "Withdraw" } });
    expect(flow.steps[2]).toMatchObject({ expect: { functionName: "withdraw", amountMustEqual: "{{amount}}" } });
  });

  it("throws when the model gives up", async () => {
    const llm = scriptedLlm([{ tool: "start_flow" }, { tool: "end_flow", input: { success: false, reason: "no such button" } }]);
    await expect(recordDescribedFlow(s, llm, "do the impossible")).rejects.toThrow(/no such button/);
  });
});

describe("proposeRepair", () => {
  const broken: Flow = {
    id: "flow_r", name: "Sign in", origin: "discovered", startUrl: "", chainId: 31337, params: [],
    steps: [
      { kind: "click", target: { role: "button", name: "Log in" } },
      { kind: "wallet", respond: "approve", expect: { kind: "message" } },
      { kind: "expect", assert: { type: "visible", text: "Signed in" } },
    ],
  };
  const run = (error: string): FlowRun => ({
    id: "run_1", flowId: "flow_r", edgeCase: "happy", status: "fail", reason: error, startedAt: "", finishedAt: "",
    steps: [{ index: 0, status: "fail", durationMs: 1000, error }],
    walletRequests: [], signingReviewIds: [], issueIds: [], console: [], rpc: [], forkBlocks: {}, mode: "fork",
  });

  it("splices the model's replacement for the failing step and verifies it", async () => {
    const flow = { ...broken, startUrl: `${s.baseUrl}/vault.html` };
    await s.page.evaluate(() => sessionStorage.setItem("account", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    const llm = scriptedLlm([
      { tool: "look" },
      (_l, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Sign in") } }),
      { tool: "wallet_approve" },
      { tool: "finish_repair", input: { resumeFromStep: 2 } },
    ], "The button is now called Sign in.");
    const res = await proposeRepair(s, llm, flow, run('No button "Log in"'), { replay: toyReplay });
    expect(res).not.toBeNull();
    expect(res!.explanation).toContain("The button is now called Sign in.");
    expect(res!.explanation).toContain("Verified");
    expect(res!.flow.steps).toEqual([
      { kind: "click", target: { role: "button", name: "Sign in" }, note: 'Click "Sign in"' },
      { kind: "wallet", respond: "approve", note: "Approve personal_sign", expect: { kind: "message" } },
      { kind: "expect", assert: { type: "visible", text: "Signed in" } },
    ]);
  });

  it("returns null when the model gives up", async () => {
    const flow = { ...broken, startUrl: `${s.baseUrl}/vault.html` };
    const llm = scriptedLlm([{ tool: "look" }, { tool: "give_up", input: { reason: "feature removed" } }]);
    expect(await proposeRepair(s, llm, flow, run("nope"), { replay: toyReplay })).toBeNull();
  });
});
