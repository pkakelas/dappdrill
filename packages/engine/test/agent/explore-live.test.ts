/**
 * Live exploration of the fixture dApp with the real model. Spends money;
 * runs only with DAPPDRILL_LIVE=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Flow } from "@dappdrill/core";
import { explore } from "../../src/agent/explorer.js";
import { createLlm } from "../../src/agent/llm.js";
import { createStubSession, type StubSession } from "./fixture/session.js";

let s: StubSession;
beforeAll(async () => {
  s = await createStubSession();
  await s.page.goto(`${s.baseUrl}/`);
}, 60_000);
afterAll(async () => {
  await s?.close();
});

describe.skipIf(!process.env.DAPPDRILL_LIVE)("explore (live model)", () => {
  it("connects, deposits and records replayable flows", async () => {
    const llm = createLlm();
    const result = await explore(s, llm, { maxFlows: 2, maxMinutes: 6, maxTurns: 40 });
    console.log("summary:", result.summary);
    console.log("pages:", result.pages);
    console.log("flows:", JSON.stringify(result.flows, null, 2));
    console.log("cost USD:", llm.costUsd().toFixed(3));

    expect(result.blocked).toBeUndefined();
    expect(result.flows.length).toBeGreaterThanOrEqual(1);
    for (const f of result.flows) Flow.parse(f);
    const deposit = result.flows.find((f) => f.steps.some((st) => st.kind === "wallet" && st.expect?.functionName === "deposit"));
    expect(deposit, "a deposit flow with a decoded wallet step").toBeDefined();
    expect(deposit!.params.map((p) => p.name)).toContain("amount");
    expect(s.wallet.requests().some((r) => r.method === "eth_requestAccounts")).toBe(true);
  }, 600_000);
});
