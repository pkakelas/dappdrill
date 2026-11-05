import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeApp } from "../../src/agent/analyst.js";
import { createStubSession, type StubSession } from "./fixture/session.js";
import { scriptedRuns } from "./fixture/scripted-llm.js";

let session: StubSession;
beforeAll(async () => {
  session = await createStubSession();
  await session.page.goto(`${session.baseUrl}/vault.html`);
});
afterAll(async () => {
  await session?.close();
});

const submission = {
  summary: "A vault.",
  pages: [{ path: "/vault.html", purpose: "Deposit" }],
  tests: [{ name: "Deposit USDC", goal: "Deposit a little.", expected: "The vault shows it.", startPath: "/vault.html", steps: ["Connect the wallet", "Click Deposit", "Approve in the wallet"] }],
};
const blocked = { tool: "report_blocked", input: { reason: "The /swap widget shows a human check" } };

describe("analyzeApp", () => {
  it("keeps the tests found elsewhere when a side page is blocked", async () => {
    const out = await analyzeApp(session, scriptedRuns([[blocked, { tool: "submit", input: submission }]]));
    expect(out.blocked).toBeUndefined();
    expect(out.tests.map((t) => t.name)).toEqual(["Deposit USDC"]);
  });

  it("reports the block when nothing could be submitted", async () => {
    const out = await analyzeApp(session, scriptedRuns([[blocked]]));
    expect(out.tests).toEqual([]);
    expect(out.blocked?.reason).toContain("human check");
  });
});
