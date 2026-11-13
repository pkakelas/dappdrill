import { describe, expect, it } from "vitest";
import type { Check } from "@dappdrill/core";
import { movedBy, unreadBefore } from "../../src/run/code-check.js";
import type { Running } from "../../src/run/running.js";

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

describe("unreadBefore", () => {
  const changes = (figure: string, on?: string): Check => ({ type: "check", by: "code", claim: `${figure} moved.`, expect: { kind: "changes", figure, by: 20, on } });
  const running = (steps: Running["steps"], before: [string, { text: string; value: number } | { missing: string }][]) => ({ steps, before: new Map(before) }) as unknown as Running;

  it("names the first check whose figure couldn't be read before the test began", () => {
    const run = running(
      [{ type: "action", by: "llm", do: "Short $20." }, changes("Cash"), changes("Your position", "/home")],
      [
        ["\nCash", { text: "100", value: 100 }],
        ["/home\nYour position", { missing: "No figure labelled “Your position”." }],
      ],
    );
    expect(unreadBefore(run)).toEqual({ line: 2, note: "Before the test began, on /home: No figure labelled “Your position”." });
  });

  it("is nothing when every figure was read", () => {
    expect(unreadBefore(running([changes("Cash")], [["\nCash", { text: "100", value: 100 }]]))).toBeUndefined();
  });
});
