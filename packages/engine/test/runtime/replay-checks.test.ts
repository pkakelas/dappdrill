import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import type { DecodedRequest, WalletRequest } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { checkExpectation } from "../../src/replay/expectation.js";
import { feedbackMessage, inspectRecovery } from "../../src/replay/issues.js";

const req = { method: "eth_sendTransaction", params: [] } as unknown as WalletRequest;
const chains = {} as ChainController;
// Lido's stake call, decoded by name from a signature database the recorder didn't have.
const submit = { kind: "transaction", to: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", functionName: "submit", args: [], calldata: "0xa1903eab00000000000000000000000011d00000000000000000000000000000000011d0" } as unknown as DecodedRequest;

describe("checkExpectation", () => {
  it("matches a recorded selector against the calldata of a call decoded by name", async () => {
    const ok = await checkExpectation({ kind: "transaction", functionName: "0xa1903eab" }, req, submit, chains, {});
    expect(ok).toMatchObject({ ok: true, problems: [], warnings: [] });

    const other = await checkExpectation({ kind: "transaction", functionName: "0x095ea7b3" }, req, submit, chains, {});
    expect(other.problems).toEqual(["expected a call to 0x095ea7b3, the dApp calls submit"]);
  });
});

describe("feedbackMessage", () => {
  it("counts a balance warning next to the amount as feedback", () => {
    // Lido's low-gas state: the amount field turns red instead of a toast.
    expect(feedbackMessage("Stake Ether\nETH amount\n0.05\nEntered ETH amount exceeds your available balance of 0.000000000000001\nMAX")).toBe(
      "Entered ETH amount exceeds your available balance of 0.000000000000001",
    );
    expect(feedbackMessage("Balance too low")).toBe("Balance too low");
    expect(feedbackMessage("Available to stake\n100.0 ETH\nBalance\nStake")).toBeUndefined();
  });
});

describe("inspectRecovery", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("calls a disabled button stuck only when nothing on the page says why", async () => {
    const page = await browser.newPage();
    await page.setContent(`<input value="0.02"><button disabled>Unlock tokens and wrap</button>`);
    expect((await inspectRecovery(page, "Unlock tokens and wrap")).stuckButton).toBe("Unlock tokens and wrap");

    await page.setContent(`<input value="0.02"><p>Entered stETH amount exceeds your available balance of 0</p><button disabled>Unlock tokens and wrap</button>`);
    const explained = await inspectRecovery(page, "Unlock tokens and wrap");
    expect(explained.stuckButton).toBeUndefined();
    expect(explained.message).toMatch(/exceeds your available balance/);

    // A busy label is stuck whatever else the page says.
    await page.setContent(`<p>Transaction failed</p><button disabled>Confirming…</button>`);
    expect((await inspectRecovery(page, "Deposit")).stuckButton).toBe("Confirming…");
    await page.close();
  });
});
