import { describe, expect, it } from "vitest";
import { alertText, composeAlert } from "../src/notify/compose.js";

const link = "https://dappdrill.test/apps/app_1";

describe("composeAlert", () => {
  it("stays quiet when nothing broke", () => {
    expect(composeAlert({ appName: "Harbor", regressions: [], link })).toBeNull();
  });

  it("names each test that stopped passing, with why", () => {
    const alert = composeAlert({
      appName: "Harbor",
      regressions: [{ testName: "Withdraw everything", flowName: "Withdraw", failure: "The Withdraw button stays disabled." }],
      link,
    })!;
    expect(alert.title).toBe("Harbor: a test stopped passing");
    expect(alert.lines).toEqual(["Withdraw · Withdraw everything: The Withdraw button stays disabled."]);
    expect(alertText(alert)).toContain(link);
  });

  it("caps the lines", () => {
    const regressions = Array.from({ length: 9 }, (_, i) => ({ testName: `Test ${i}`, flowName: "Trade" }));
    const alert = composeAlert({ appName: "Harbor", regressions, link })!;
    expect(alert.title).toBe("Harbor: 9 tests stopped passing");
    expect(alert.lines).toHaveLength(7);
    expect(alert.lines.at(-1)).toBe("and 3 more");
  });
});
