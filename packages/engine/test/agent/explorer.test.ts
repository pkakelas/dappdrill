import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Flow } from "@dappdrill/core";
import { explore, type ExplorePlan } from "../../src/agent/explorer.js";
import { refOf, scriptedRuns } from "./fixture/scripted-llm.js";
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

const planned = (name: string, level: number, startPath = "/", dependsOn: string[] = []) => ({ name, level, why: "", how: name, startPath, dependsOn });
const plan = (flows: ExplorePlan["flows"]): ExplorePlan => ({ profile: "Tiny Vault: deposit and withdraw USDC", persona: "A saver who checks every number", flows });
const logs = () => s.events.flatMap((e) => (e.type === "log" ? [e.message] : []));

describe("explore with scripted models", () => {
  it("plans with the thinking model, records with the acting model, and retries a failure with the thinking model", async () => {
    const think = scriptedRuns([
      [
        { tool: "look" },
        { tool: "goto", input: { url: "https://evil.example.com/" } },
        { tool: "note_page", input: { url: "/vault.html", purpose: "Deposit and withdraw USDC" } },
        {
          tool: "submit_plan",
          input: plan([
            planned("Deposit USDC", 1, "/vault.html"),
            planned("Sign in", 1, "/vault.html"),
            planned("Withdraw USDC", 2, "/vault.html", ["Sign in"]),
            planned("Deposit dust", 3, "/vault.html"),
          ]),
        },
      ],
      // The retry of "Sign in".
      [{ tool: "end_flow", input: { success: false, reason: "signing in only works by rejecting" } }],
    ]);
    const act = scriptedRuns([
      [
        // Each flow starts as a new visitor on its start page, so connecting is part of the flow.
        { tool: "look" },
        (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Connect wallet") } }),
        (last) => ({ tool: "click", input: { ref: refOf(last, "button", "MetaMask"), why: "Choose MetaMask" } }),
        (_last, page) => ({ tool: "type", input: { ref: refOf(page, "textbox", "Amount"), text: "12.5" } }),
        (_last, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Deposit") } }),
        { tool: "wallet_status" },
        { tool: "wallet_approve" },
        { tool: "wallet_approve" },
        { tool: "end_flow", input: { success: true, successText: "Deposited 12.5 USDC" } },
      ],
      [
        { tool: "look" },
        (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Connect wallet") } }),
        (last) => ({ tool: "click", input: { ref: refOf(last, "button", "MetaMask") } }),
        (_last, page) => ({ tool: "click", input: { ref: refOf(page, "button", "Sign in") } }),
        { tool: "wallet_reject" },
        { tool: "end_flow", input: { success: false, reason: "rejected on purpose" } },
      ],
    ]);

    const flowsSeen: Flow[] = [];
    const result = await explore(s, { think, act }, { maxFlows: 3, maxMinutes: 5, depth: 2, onFlow: (f) => flowsSeen.push(f) });

    expect(result.blocked).toBeUndefined();
    expect(result.persona).toBe("A saver who checks every number");
    expect(result.flows).toHaveLength(1);
    expect(flowsSeen).toEqual(result.flows);
    expect(result.pages.map((p) => p.url)).toEqual(expect.arrayContaining([`${s.baseUrl}/`, `${s.baseUrl}/vault.html`]));
    expect(result.pages.find((p) => p.url.endsWith("/vault.html"))?.title).toBe("Deposit and withdraw USDC");
    expect(result.plan.map((p) => [p.name, p.outcome])).toEqual([
      ["Deposit USDC", "recorded"],
      ["Sign in", "failed"],
      ["Withdraw USDC", "skipped"],
      ["Deposit dust", "not reached"],
    ]);
    expect(result.summary).toBe(
      "Recorded 1 of 3 planned flows. “Sign in” failed: signing in only works by rejecting. “Withdraw USDC” skipped: needs “Sign in”, which wasn't recorded.",
    );
    expect(logs()).toContainEqual(expect.stringMatching(/^Couldn't record “Sign in” \(rejected on purpose\); trying again with the thinking model/));

    // The cross-origin goto was refused and not recorded.
    expect(think.results[1]).toMatch(/Refused/);

    const flow = Flow.parse(result.flows[0]);
    expect(flow.origin).toBe("discovered");
    expect(flow.name).toBe("Deposit USDC");
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
    expect(act.results[4]).toMatch(/Wallet request req_\w+ is waiting: eth_sendTransaction to 0x2222…2222: approve/);
    expect(act.results[6]).toMatch(/Approved req_\w+ .*The amount matches what you typed/);
    expect(act.results[8]).toMatch(/Saved "Deposit USDC" with 7 steps and params amount/);
    expect(act.results[13]).toMatch(/Rejected req_\w+ \(personal_sign: "Sign in to Tiny Vault/);
    expect(s.wallet.requests().filter((r) => r.kind === "sign").map((r) => r.outcome)).toEqual(["approved", "approved", "rejected"]);

    const events = s.events.map((e) => e.type);
    expect(events).toContain("flow");
    expect(events).toContain("page");
    expect(events).toContain("cost");
  });

  it("records the wallet's address as {{account}}, keeps the id of a flow an earlier scan saved, and stops at the flow limit", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    const think = scriptedRuns([[{ tool: "submit_plan", input: plan([planned("Connect wallet", 1), planned("Deposit USDC", 1, "/vault.html")]) }]]);
    const act = scriptedRuns([
      [
        { tool: "look" },
        (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Connect wallet") } }),
        (last) => ({ tool: "click", input: { ref: refOf(last, "button", "MetaMask") } }),
        () => ({ tool: "end_flow", input: { success: true, successText: `Connected: ${s.wallet.address().slice(0, 6)}…${s.wallet.address().slice(-4)}` } }),
      ],
    ]);
    const result = await explore(s, { think, act }, { maxFlows: 1, maxMinutes: 1, knownFlows: [{ id: "flow_saved", name: "connect wallet" }] });
    expect(act.results.at(-1)).toMatch(/Saved "Connect wallet"/);
    expect(result.flows[0]?.id).toBe("flow_saved");
    expect(result.flows[0]?.steps.at(-1)).toEqual({ kind: "expect", assert: { type: "visible", text: "Connected: {{account-head}}…{{account-tail}}" } });
    expect(result.plan[1]).toMatchObject({ name: "Deposit USDC", outcome: "not reached", note: "the flow limit was reached" });
  });

  it("moves on without a retry when the cause of a failure is clear", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    const think = scriptedRuns([[{ tool: "submit_plan", input: plan([planned("Mint test USD", 1)]) }]]);
    const act = scriptedRuns([[{ tool: "end_flow", input: { success: false, cause: "setup", reason: "The faucet says rate limited." } }]]);
    const result = await explore(s, { think, act }, { maxFlows: 2, maxMinutes: 1 });
    expect(result.plan[0]).toMatchObject({ outcome: "failed", cause: "setup", note: "The faucet says rate limited" });
    expect(think.results).toHaveLength(1);
    expect(result.summary).toBe("Recorded 0 of 1 planned flows. “Mint test USD” failed: The faucet says rate limited.");
  });

  it("records a given plan without a survey, leaves out skipped flows and streams progress as plan events", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    const before = s.events.length;
    const think = scriptedRuns([]);
    const act = scriptedRuns([[{ tool: "goto", input: { url: "/vault.html" } }, { tool: "end_flow", input: { success: true } }]]);
    const given = plan([planned("Open the vault", 1), planned("Deposit dust", 1)]);
    const result = await explore(s, { think, act }, { maxFlows: 2, maxMinutes: 1, plan: given, skip: ["deposit dust"] });
    expect(think.results).toEqual([]);
    expect(result.plan.map((p) => [p.name, p.outcome])).toEqual([["Open the vault", "recorded"]]);
    expect(logs()).toContain("Leaving out 1 planned flow(s) you chose not to test");
    const progress = s.events.slice(before).flatMap((e) => (e.type === "plan" ? [e.plan.items.map((i) => i.outcome)] : []));
    expect(progress[0]).toEqual(["not reached"]);
    expect(progress.at(-1)).toEqual(["recorded"]);
  });

  it("records independent flows at the same time in separate lanes, and dependent ones in the same lane", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    const visits = new Map<StubSession, string[]>();
    const track = (session: StubSession) => {
      visits.set(session, []);
      session.page.on("framenavigated", (f) => {
        if (f === session.page.mainFrame()) visits.get(session)!.push(new URL(f.url()).search);
      });
      return session;
    };
    track(s);
    const think = scriptedRuns([
      [{ tool: "submit_plan", input: plan([planned("Deposit", 1, "/vault.html?deposit"), planned("Look around", 1, "/vault.html?look"), planned("Withdraw", 2, "/vault.html?withdraw", ["Deposit"])]) }],
    ]);
    const flow = [{ tool: "goto", input: { url: "/" } }, { tool: "end_flow", input: { success: true } }];
    const act = scriptedRuns([flow, flow, flow]);
    const result = await explore(s, { think, act }, { maxFlows: 5, maxMinutes: 1, lanes: 3, openLane: async () => track(await createStubSession({ url: s.baseUrl })) });

    expect(result.plan.map((p) => p.outcome)).toEqual(["recorded", "recorded", "recorded"]);
    // Two groups, so only one more lane opened.
    expect(visits.size).toBe(2);
    expect(logs()).toContain("Recording 2 flows at a time, each in its own browser with its own test accounts");
    const laneOf = (search: string) => [...visits].find(([, v]) => v.includes(search))?.[0];
    expect(laneOf("?deposit")).toBeDefined();
    expect(laneOf("?withdraw")).toBe(laneOf("?deposit"));
    expect(laneOf("?look")).not.toBe(laneOf("?deposit"));
  });

  it("keeps navigating on the domain the app redirected to", async () => {
    // As if 127.0.0.1 redirected to localhost (app.spark.fi → app.spark.finance).
    const landed = s.baseUrl.replace("127.0.0.1", "localhost");
    await s.page.goto(`${landed}/`);
    const think = scriptedRuns([
      [
        { tool: "goto", input: { url: "/vault.html" } },
        { tool: "goto", input: { url: "https://evil.example.com/" } },
      ],
    ]);
    const result = await explore(s, { think, act: think }, { maxFlows: 1, maxMinutes: 1 });
    expect(think.results[0]).toMatch(/^Opened http:\/\/localhost:\d+\/vault\.html/);
    expect(think.results[1]).toMatch(/Refused/);
    // No plan was submitted and the fallback couldn't write one.
    expect(result.summary).toBe("No plan, so no flows were recorded.");
  });

  it("stops at a bot check without touching it", async () => {
    await s.page.setContent(`<title>Just a moment...</title><h1>Checking your browser</h1><button>Verify you are human</button>`);
    const think = scriptedRuns([
      [
        { tool: "look" },
        (last) => ({ tool: "click", input: { ref: refOf(last, "button", "Verify you are human") } }),
        { tool: "report_blocked", input: { reason: "Cloudflare challenge" } },
      ],
    ]);
    const result = await explore(s, { think, act: think }, { maxFlows: 1, maxMinutes: 1 });
    expect(think.results[1]).toMatch(/WARNING: Blocked by Cloudflare's bot check/);
    expect(result.blocked).toMatchObject({ provider: "Cloudflare", reason: "Cloudflare challenge" });
    expect(result.flows).toEqual([]);
  });
});
