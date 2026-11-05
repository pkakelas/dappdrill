import { describe, expect, it } from "vitest";
import { walletUse, type TestStep } from "../src/test.js";

const click: TestStep = { text: "Click Deposit", actions: [{ kind: "click", target: { name: "Deposit", role: "button" } } as never] };
const sign: TestStep = { text: "Approve in the wallet", actions: [{ kind: "wallet", respond: "approve" } as never] };
const check: TestStep = { text: "See the balance", actions: [] };
const notRun: TestStep = { text: "Approve in the wallet" };

describe("walletUse", () => {
  it("signs as soon as a step recorded a wallet action, even if later steps never ran", () => {
    expect(walletUse([click, sign, notRun])).toBe("signs");
  });
  it("is none only when every step ran without one", () => {
    expect(walletUse([click, check])).toBe("none");
  });
  it("is unknown while steps haven't run, or there are none", () => {
    expect(walletUse([click, notRun])).toBe("unknown");
    expect(walletUse([])).toBe("unknown");
  });
});
