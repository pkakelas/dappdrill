import { describe, expect, it } from "vitest";
import { anyFigures } from "../../src/replay/locators.js";

describe("anyFigures", () => {
  it("takes another figure where a live one was recorded", () => {
    const row = anyFigures("0.01 ETH22.223 USDCIn progressJust now")!;
    expect(row.test("0.01 ETH21.98 USDCIn progressJust now")).toBe(true);
    expect(row.test("0.01 ETH 2,201.5 USDCIn progress Just now")).toBe(false);
    expect(row.test("0.01 ETH22.223 USDCCompleted1 hour ago")).toBe(false);
  });

  it("leaves labels and bare numbers alone", () => {
    expect(anyFigures("25%")).toBeUndefined();
    expect(anyFigures("Page 2")).toBeUndefined();
    expect(anyFigures("0.5")).toBeUndefined();
    expect(anyFigures("Bridge")).toBeUndefined();
  });
});
