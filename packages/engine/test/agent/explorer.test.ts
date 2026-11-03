import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Flow } from "@dappdrill/core";
import { explore } from "../../src/agent/explorer.js";
import { refOf, scriptedLlm } from "./fixture/scripted-llm.js";
import { createStubSession, type StubSession } from "./fixture/session.js";

vi.setConfig({ testTimeout: 60_000 });

let s: StubSession;
beforeAll(async () => {
  s = await createStubSession();
  await s.page.goto(`${s.baseUrl}/`);
}, 60_000);
afterAll(async () => {
  await s?.close();
});

describe("explore with a scripted model", () => {
  it("records a deposit flow with locators, wallet expectations and an amount param", async () => {
    const llm = scriptedLlm([
      { tool: "look" },
      { tool: "goto", input: { url: "https://evil.example.com/" } },
      { tool: "note_page", input: { url: "/vault.html", purpose: "Deposit and withdraw USDC" } },
      { tool: "goto", input: { url: "/vault.html" } },
      // start_flow reloads as a new visitor, so connecting is part of the flow.
      { tool: "start_flow", input: { name: "Deposit USDC" } },
      (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Connect wallet") } }),
      (last) => ({ tool: "click", input: { ref: refOf(last, "button", "MetaMask"), why: "Choose MetaMask" } }),
      (_last, page) => ({ tool: "type", input: { ref: refOf(page, "textbox", "Amount"), text: "12.5" } }),
      (_last, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Deposit") } }),
      { tool: "wallet_status" },
      { tool: "wallet_approve" },
      { tool: "wallet_approve" },
      { tool: "end_flow", input: { success: true, successText: "Deposited 12.5 USDC" } },
      { tool: "start_flow", input: { name: "Sign in" } },
      (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Connect wallet") } }),
      (last) => ({ tool: "click", input: { ref: refOf(last, "button", "MetaMask") } }),
      (_last, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Sign in") } }),
      { tool: "wallet_reject" },
      { tool: "end_flow", input: { success: false, reason: "rejected on purpose" } },
    ], "Explored the vault.");

    const flowsSeen: Flow[] = [];
    const result = await explore(s, llm, { maxFlows: 3, maxMinutes: 5, onFlow: (f) => flowsSeen.push(f) });

    expect(result.summary).toBe("Explored the vault.");
    expect(result.blocked).toBeUndefined();
    expect(result.flows).toHaveLength(1);
    expect(flowsSeen).toEqual(result.flows);
    expect(result.pages.map((p) => p.url)).toEqual(expect.arrayContaining([`${s.baseUrl}/`, `${s.baseUrl}/vault.html`]));
    expect(result.pages.find((p) => p.url.endsWith("/vault.html"))?.title).toBe("Deposit and withdraw USDC");

    // The cross-origin goto was refused and not recorded.
    expect(llm.results[1]).toMatch(/Refused/);

    const flow = Flow.parse(result.flows[0]);
    expect(flow.origin).toBe("discovered");
    expect(flow.startUrl).toBe(`${s.baseUrl}/vault.html`);
    expect(flow.chainId).toBe(31337);
    expect(flow.params).toEqual([{ name: "amount", default: "12.5", description: expect.any(String) }]);
    expect(flow.steps).toEqual([
      { kind: "click", target: { role: "button", name: "Connect wallet" }, note: 'Click "Connect wallet"', optional: true },
      { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true }, note: "Choose MetaMask", optional: true },
      { kind: "fill", target: { role: "textbox", name: "Amount" }, value: "{{amount}}" },
      { kind: "click", target: { role: "button", name: "Deposit" }, note: 'Click "Deposit"' },
      {
        kind: "wallet", respond: "approve", note: expect.stringContaining("Approve"),
        expect: { kind: "transaction", to: "0x2222222222222222222222222222222222222222", functionName: "approve", spenderMustBe: "0x1111111111111111111111111111111111111111", amountMustEqual: "{{amount}}", failIfUnlimited: true },
      },
      {
        kind: "wallet", respond: "approve", note: expect.stringContaining("Approve"),
        expect: { kind: "transaction", to: "0x1111111111111111111111111111111111111111", functionName: "deposit", amountMustEqual: "{{amount}}" },
      },
      { kind: "expect", assert: { type: "visible", text: "Deposited 12.5 USDC" } },
    ]);

    // Tool results carry the wallet request and the fresh page state.
    expect(llm.results[8]).toMatch(/Wallet request req_\w+ is waiting: eth_sendTransaction to 0x2222…2222: approve/);
    expect(llm.results[10]).toMatch(/Approved req_\w+ .*The amount matches what you typed/);
    expect(llm.results[12]).toMatch(/Saved "Deposit USDC" with 7 steps and params amount/);
    expect(llm.results[17]).toMatch(/Rejected req_\w+ \(personal_sign: "Sign in to Tiny Vault/);
    expect(s.wallet.requests().filter((r) => r.kind === "sign").map((r) => r.outcome)).toEqual(["approved", "approved", "rejected"]);

    const events = s.events.map((e) => e.type);
    expect(events).toContain("flow");
    expect(events).toContain("page");
    expect(events).toContain("cost");
  });

  it("records the wallet's address as {{account}} and keeps the id of a flow an earlier scan saved", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    const llm = scriptedLlm([
      { tool: "start_flow", input: { name: "Connect wallet" } },
      (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Connect wallet") } }),
      (last) => ({ tool: "click", input: { ref: refOf(last, "button", "MetaMask") } }),
      () => ({ tool: "end_flow", input: { success: true, successText: `Connected: ${s.wallet.address().slice(0, 6)}…${s.wallet.address().slice(-4)}` } }),
    ]);
    const result = await explore(s, llm, { maxFlows: 1, maxMinutes: 1, knownFlows: [{ id: "flow_saved", name: "connect wallet" }] });
    expect(llm.results.at(-1)).toMatch(/Saved "Connect wallet"/);
    expect(result.flows[0]?.id).toBe("flow_saved");
    expect(result.flows[0]?.steps.at(-1)).toEqual({ kind: "expect", assert: { type: "visible", text: "Connected: {{account-head}}…{{account-tail}}" } });
  });

  it("keeps navigating on the domain the app redirected to", async () => {
    // As if 127.0.0.1 redirected to localhost (app.spark.fi → app.spark.finance).
    const landed = s.baseUrl.replace("127.0.0.1", "localhost");
    await s.page.goto(`${landed}/`);
    const llm = scriptedLlm([
      { tool: "goto", input: { url: "/vault.html" } },
      { tool: "goto", input: { url: "https://evil.example.com/" } },
    ]);
    await explore(s, llm, { maxFlows: 1, maxMinutes: 1 });
    expect(llm.results[0]).toMatch(/^Opened http:\/\/localhost:\d+\/vault\.html/);
    expect(llm.results[1]).toMatch(/Refused/);
  });

  it("stops at a bot check without touching it", async () => {
    await s.page.setContent(`<title>Just a moment...</title><h1>Checking your browser</h1><button>Verify you are human</button>`);
    const llm = scriptedLlm([
      { tool: "look" },
      (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Verify you are human") } }),
      { tool: "report_blocked", input: { reason: "Cloudflare challenge" } },
    ]);
    const result = await explore(s, llm, { maxFlows: 1, maxMinutes: 1 });
    expect(llm.results[1]).toMatch(/WARNING: The page title looks like a bot check/);
    expect(result.blocked).toBe("Cloudflare challenge");
    expect(result.flows).toEqual([]);
  });
});
