import { describe, expect, it } from "vitest";
import { formatHints, parseHints, type HintAnswers } from "../src/hints.js";

describe("hints", () => {
  it("writes answers the way the analyst has always read them", () => {
    expect(formatHints({ flows: ["Swap ETH", " ", "Claim"], tips: { access: "Sign in with the wallet", avoid: " " } })).toBe("Flows to test:\n- Swap ETH\n- Claim\nHow to get in: Sign in with the wallet");
    expect(formatHints({ flows: [""], tips: {} })).toBe("");
  });

  it("reads back what it wrote", () => {
    const answers: HintAnswers = { flows: ["Swap ETH", "Claim"], tips: { access: "Invite code in the footer", notes: "A popup covers every page.\nPrices take a minute.", tokens: "USDC on Base", avoid: "The referral flow" } };
    expect(parseHints(formatHints(answers))).toEqual(answers);
  });

  it("reads hints that went through a form post", () => {
    expect(parseHints("Flows to test:\r\n- Swap\r\nHard to explore: Slow\r\nReally slow\r\nWhat to avoid: Referrals")).toEqual({ flows: ["Swap"], tips: { notes: "Slow\nReally slow", avoid: "Referrals" } });
  });

  it("keeps notes saved before the questions existed", () => {
    expect(parseHints("Withdraw is on the Vault tab.\n\nUse USDC.")).toEqual({ flows: [], tips: { notes: "Withdraw is on the Vault tab.\n\nUse USDC." } });
  });

  it("keeps stray text next to answers", () => {
    expect(parseHints("Look at /trade\nFlows to test:\n- Swap\nnot a flow\nHard to explore: Slow")).toEqual({ flows: ["Swap"], tips: { notes: "Look at /trade\nnot a flow\nSlow" } });
  });

  it("is empty for no hints", () => {
    expect(parseHints("")).toEqual({ flows: [], tips: {} });
  });
});
