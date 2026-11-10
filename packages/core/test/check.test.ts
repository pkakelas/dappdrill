import { describe, expect, it } from "vitest";
import { isLabel, keepActions, repeatable, testCheckKey, type CheckAssert, type TestStep } from "../src/index.js";

describe("repeatable", () => {
  const is = (assert: CheckAssert) => repeatable(assert);

  it("keeps checks about the page's words, the address, the wallet and the chain", () => {
    expect(is({ kind: "well-formed" })).toBe(true);
    expect(is({ kind: "url", value: "/trade" })).toBe(true);
    expect(is({ kind: "no-wallet" })).toBe(true);
    expect(is({ kind: "tx" })).toBe(true);
    expect(is({ kind: "wallet", value: "withdraw" })).toBe(true);
    expect(is({ kind: "shows", value: "Order placed" })).toBe(true);
    expect(is({ kind: "hides", value: "Insufficient margin" })).toBe(true);
  });

  it("drops text that copied a number or a date off the page", () => {
    expect(is({ kind: "shows", value: "$20.00 received" })).toBe(false);
    expect(is({ kind: "hides", value: "Nov 10" })).toBe(false);
  });

  it("keeps figures named by their label, not by their number", () => {
    expect(is({ kind: "balance", value: "Cash" })).toBe(true);
    expect(is({ kind: "balance", value: "9,916.29" })).toBe(false);
    expect(is({ kind: "price", value: "Mark price", token: "AAPL" })).toBe(true);
    expect(is({ kind: "price", value: "349.42", token: "AAPL" })).toBe(false);
    expect(is({ kind: "wallet-amount", value: "You pay", token: "USDC" })).toBe(true);
    expect(is({ kind: "wallet-amount", value: "20", token: "USDC" })).toBe(false);
  });

  it("keeps a sum in labels, with only small whole constants of its own", () => {
    expect(is({ kind: "adds-up", value: "Size × Mark price = Position value" })).toBe(true);
    expect(is({ kind: "adds-up", value: "Cash + Unrealized P&L = Portfolio value" })).toBe(true);
    expect(is({ kind: "adds-up", value: "Amount * Rate / 100 = Fee" })).toBe(true);
    expect(is({ kind: "adds-up", value: "0.2509 * 349.42 = 87.68" })).toBe(false);
    expect(is({ kind: "adds-up", value: "Cash + 0.33 = Portfolio value" })).toBe(false);
  });

  it("reads a label as anything without a digit", () => {
    expect(isLabel("Mark price")).toBe(true);
    expect(isLabel("1,682.56")).toBe(false);
    expect(isLabel("")).toBe(false);
    expect(isLabel(undefined)).toBe(false);
  });
});

describe("testCheckKey", () => {
  it("reads the same claim as one check however it is spaced or cased", () => {
    const a = testCheckKey({ name: "Cash matches the chain", assert: { kind: "balance", value: "Cash" } });
    expect(testCheckKey({ name: "cash  matches the chain", assert: { kind: "balance", value: "Cash" } })).toBe(a);
    expect(testCheckKey({ name: "Cash matches the chain", assert: { kind: "balance", value: "Cash", token: "0xusdc" } })).not.toBe(a);
  });
});

describe("keepActions", () => {
  const old: TestStep[] = [
    { text: "Open Home", actions: [{ kind: "click", target: { role: "link", name: "Home" } }], checks: [{ name: "Home numbers well-formed", assert: { kind: "well-formed" } }] },
    { text: "Read Cash", checks: [{ name: "Cash matches the chain", assert: { kind: "balance", value: "Cash" } }] },
  ];

  it("keeps the checks along with the actions of a step whose words didn't change", () => {
    const kept = keepActions(["Open Home", "Read cash.", "Reload"], old);
    expect(kept[0]).toEqual(old[0]);
    expect(kept[1]).toEqual({ text: "Read cash.", checks: old[1]!.checks });
    expect(kept[2]).toEqual({ text: "Reload" });
  });

  it("drops both when the words changed", () => {
    expect(keepActions(["Open the Home page"], old)).toEqual([{ text: "Open the Home page" }]);
  });
});
