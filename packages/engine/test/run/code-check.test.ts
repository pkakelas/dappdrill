import { describe, expect, it } from "vitest";
import { movedBy } from "../../src/run/code-check.js";

const shown = (text: string) => ({ text, value: Number(text.replace(/,/g, "")) });

describe("movedBy", () => {
  it("takes the change that was named", () => {
    expect(movedBy(shown("1,000.00"), shown("900.00"), -100)).toBe(true);
    expect(movedBy(shown("0.00"), shown("60.00"), 60)).toBe(true);
    expect(movedBy(shown("1,000.00"), shown("1,000.00"), 0)).toBe(true);
  });

  it("refuses another change", () => {
    expect(movedBy(shown("1,000.00"), shown("800.00"), -100)).toBe(false);
    expect(movedBy(shown("1,000.00"), shown("1,000.00"), -100)).toBe(false);
    expect(movedBy(shown("1,000.00"), shown("999.00"), 0)).toBe(false);
  });

  it("allows one unit of the last digit shown, for rounding", () => {
    expect(movedBy(shown("10.5"), shown("10.6"), 0.07)).toBe(true);
    expect(movedBy(shown("10"), shown("11"), 0.4)).toBe(true);
    expect(movedBy(shown("10.50"), shown("10.60"), 0.07)).toBe(false);
  });

  it("allows half a percent of the change, for fees", () => {
    expect(movedBy(shown("1,000.00"), shown("900.40"), -100)).toBe(true);
    expect(movedBy(shown("1,000.00"), shown("901.00"), -100)).toBe(false);
  });
});
