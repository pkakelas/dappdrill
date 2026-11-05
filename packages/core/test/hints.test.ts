import { describe, expect, it } from "vitest";
import { formatHints, parseHints, type HintAnswers } from "../src/hints.js";

describe("hints", () => {
  it("writes answers the way the analyst has always read them", () => {
    expect(formatHints({ tests: ["Swap ETH", " ", "Claim"], tips: { access: "Sign in with the wallet", avoid: " " } })).toBe("What to test:\n- Swap ETH\n- Claim\nHow to get in: Sign in with the wallet");
    expect(formatHints({ tests: [""], tips: {} })).toBe("");
  });

  it("reads back what it wrote", () => {
    const answers: HintAnswers = { tests: ["Swap ETH", "Claim"], tips: { access: "Invite code in the footer", notes: "A popup covers every page.\nPrices take a minute.", tokens: "USDC on Base", avoid: "The referral page" } };
    expect(parseHints(formatHints(answers))).toEqual(answers);
  });

  it("reads hints that went through a form post", () => {
    expect(parseHints("What to test:\r\n- Swap\r\nHard to explore: Slow\r\nReally slow\r\nWhat to avoid: Referrals")).toEqual({ tests: ["Swap"], tips: { notes: "Slow\nReally slow", avoid: "Referrals" } });
  });

  it("keeps notes saved before the questions existed", () => {
    expect(parseHints("Withdraw is on the Vault tab.\n\nUse USDC.")).toEqual({ tests: [], tips: { notes: "Withdraw is on the Vault tab.\n\nUse USDC." } });
  });

  it("keeps stray text next to answers", () => {
    expect(parseHints("Look at /trade\nWhat to test:\n- Swap\nnot a test\nHard to explore: Slow")).toEqual({ tests: ["Swap"], tips: { notes: "Look at /trade\nnot a test\nSlow" } });
  });

  it("is empty for no hints", () => {
    expect(parseHints("")).toEqual({ tests: [], tips: {} });
  });
});
