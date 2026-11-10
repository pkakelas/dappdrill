import { describe, expect, it } from "vitest";
import { sameValue } from "../../src/replay/fill.js";

describe("sameValue", () => {
  it("takes a number however the field formats it", () => {
    expect(sameValue("210", "210")).toBe(true);
    expect(sameValue("210", "$210.00")).toBe(true);
    expect(sameValue("1000", "1,000")).toBe(true);
    expect(sameValue("0.5", ".5")).toBe(true);
    expect(sameValue("100", "100 USDC")).toBe(true);
  });

  it("sees a field that kept the old value or dropped what was typed", () => {
    expect(sameValue("210", "200.00")).toBe(false);
    expect(sameValue("210", "")).toBe(false);
    expect(sameValue("210.5", "210")).toBe(false);
    expect(sameValue("10", "")).toBe(false);
  });

  it("looks for words inside what the field shows", () => {
    expect(sameValue("0xabc", "0xABC")).toBe(true);
    expect(sameValue("alice@example.com", "alice@example.com")).toBe(true);
    expect(sameValue("GOOGL", "AAPL")).toBe(false);
  });
});
