/**
 * The recovery judge against the real model. Runs only with DAPPDRILL_LIVE=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRecoveryJudge } from "../../src/agent/judge.js";
import { createLlm } from "../../src/agent/llm.js";
import { createStubSession, type StubSession } from "./fixture/session.js";

let s: StubSession;
const shot = async () => ({ data: (await s.page.screenshot({ type: "png" })).toString("base64"), mediaType: "image/png" as const });
beforeAll(async () => {
  s = await createStubSession();
}, 60_000);
afterAll(async () => {
  await s?.close();
});

describe.skipIf(!process.env.DAPPDRILL_LIVE)("recovery judge (live model)", () => {
  it("tells a stuck spinner from a clean recovery", async () => {
    const judge = createRecoveryJudge(createLlm());
    await s.page.goto(`${s.baseUrl}/vault.html`);
    await s.page.evaluate(() => sessionStorage.setItem("account", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    await s.page.reload();
    await s.page.getByRole("button", { name: "Deposit" }).evaluate((el) => { (el as HTMLButtonElement).disabled = true; });
    await s.page.locator("#status").evaluate((el) => { el.textContent = "Confirming… (waiting for wallet)"; });
    const stuck = await judge.judge({
      screenshot: await shot(),
      pageText: await s.page.innerText("body"),
      edgeCase: "The user rejected the deposit in the wallet 30 seconds ago",
      expected: "Show that the request was rejected and let the user try again",
    });
    expect(stuck.ok).toBe(false);

    await s.page.getByRole("button", { name: "Deposit" }).evaluate((el) => { (el as HTMLButtonElement).disabled = false; });
    await s.page.locator("#status").evaluate((el) => { el.textContent = "Transaction rejected in wallet. You can try again."; });
    const fine = await judge.judge({
      screenshot: await shot(),
      pageText: await s.page.innerText("body"),
      edgeCase: "The user rejected the deposit in the wallet",
      expected: "Show that the request was rejected and let the user try again",
    });
    expect(fine.ok).toBe(true);
  }, 120_000);
});
