import { describe, expect, it } from "vitest";
import { SigningReview } from "@dappdrill/core";
import { alertText, composeAlert, newDangerous, signatureKey, slackPayload } from "../src/notify/compose.js";

const link = "https://dappdrill.test/apps/app_1";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const BAD = "0x9f3a2c7bd5e1f4a6c8b0d2e4f6a8c0b2d4e6f8a1";
const OTHER = "0x1111111111111111111111111111111111111111";

const approval = (spender: string, amount = "") => ({ standard: "erc20", token: USDC, spender, amount, display: "USDC", unlimited: !amount });
const review = (patch: Record<string, unknown> = {}) =>
  SigningReview.parse({
    id: "sgr_1",
    requestId: "req_1",
    chainId: 8453,
    method: "eth_sendTransaction",
    verdict: "dangerous",
    title: "Unlimited USDC approval to an unverified contract",
    summary: "",
    decoded: { kind: "transaction", to: USDC, functionName: "approve", signature: "approve(address,uint256)" },
    approvals: [approval(BAD)],
    explanation: "",
    fingerprint: "fp_1",
    createdAt: "2026-11-05T00:00:00Z",
    ...patch,
  });

const inClaim = (reviews: SigningReview[], condition?: string) => ({ testName: "Claim rewards", condition, reviews });

describe("composeAlert", () => {
  it("stays quiet when nothing broke", () => {
    expect(composeAlert({ appName: "Harbor", regressions: [], link })).toBeNull();
  });

  it("names each test that stopped passing, with why", () => {
    const alert = composeAlert({
      appName: "Harbor",
      regressions: [
        { testName: "Withdraw everything", failure: "The Withdraw button stays disabled." },
        { testName: "Deposit USDC", condition: "Slow RPC", failure: "The spinner never stops." },
      ],
      link,
    })!;
    expect(alert.title).toBe("Harbor: 2 tests stopped passing");
    expect(alert.lines).toEqual([
      "Withdraw everything: The Withdraw button stays disabled.",
      "Deposit USDC · Slow RPC: The spinner never stops.",
    ]);
    expect(alertText(alert)).toContain(link);
  });

  it("caps the lines", () => {
    const regressions = Array.from({ length: 9 }, (_, i) => ({ testName: `Test ${i}` }));
    const alert = composeAlert({ appName: "Harbor", regressions, link })!;
    expect(alert.title).toBe("Harbor: 9 tests stopped passing");
    expect(alert.lines).toHaveLength(7);
    expect(alert.lines.at(-1)).toBe("and 3 more");
  });

  it("alerts on a Dangerous signature with no regression", () => {
    const dangerous = newDangerous([inClaim([review()])], new Set());
    const alert = composeAlert({ appName: "Harbor", regressions: [], dangerous, link })!;
    expect(alert.title).toBe("Harbor: a new dangerous signature");
    expect(alert.lines).toEqual(["Dangerous signature in Claim rewards: Unlimited USDC approval to an unverified contract"]);
    expect(alertText(alert)).toContain(link);
    expect(JSON.stringify(slackPayload(alert))).toContain("Dangerous signature in Claim rewards");
  });

  it("puts both in one alert, Dangerous first so the cap can't hide it", () => {
    const dangerous = newDangerous([inClaim([review()])], new Set());
    const regressions = Array.from({ length: 9 }, (_, i) => ({ testName: `Test ${i}` }));
    const alert = composeAlert({ appName: "Harbor", regressions, dangerous, link })!;
    expect(alert.title).toBe("Harbor: a new dangerous signature, 9 tests stopped passing");
    expect(alert.lines[0]).toMatch(/^Dangerous signature in/);
    expect(alert.lines.at(-1)).toBe("and 4 more");
  });
});

describe("newDangerous", () => {
  it("ignores Check this and Looks consistent", () => {
    expect(newDangerous([inClaim([review({ verdict: "check" }), review({ verdict: "consistent" })])], new Set())).toEqual([]);
  });

  it("skips a signature the team was already told about", () => {
    expect(newDangerous([inClaim([review()])], new Set([signatureKey(review())]))).toEqual([]);
  });

  it("lists a signature once across a test and its conditions, under the test", () => {
    const [found, ...rest] = newDangerous(
      [inClaim([review()], "Slow RPC"), inClaim([review()]), inClaim([review(), review()], "Low gas")],
      new Set(),
    );
    expect(rest).toEqual([]);
    expect(found).toMatchObject({ condition: undefined, others: 2 });
    expect(composeAlert({ appName: "Harbor", regressions: [], dangerous: [found!], link })!.lines[0]).toContain("Claim rewards (and 2 other tests):");
  });

  it("names a condition when only a condition saw it", () => {
    const dangerous = newDangerous([inClaim([review()], "Slow RPC")], new Set());
    expect(composeAlert({ appName: "Harbor", regressions: [], dangerous, link })!.lines[0]).toContain("Claim rewards · Slow RPC:");
  });
});

describe("signatureKey", () => {
  it("is the same across runs, paths through the test and moving quotes", () => {
    const first = signatureKey(review());
    expect(signatureKey(review({ id: "sgr_2", requestId: "req_2", fingerprint: "fp_2", stepIndex: 3, testId: "test_9", createdAt: "2026-11-06T00:00:00Z" }))).toBe(first);
    expect(signatureKey(review({ approvals: [approval(BAD.toUpperCase().replace("0X", "0x"))] }))).toBe(first);
    const limited = (amount: string) => signatureKey(review({ approvals: [approval(BAD, amount)] }));
    expect(limited("100")).toBe(limited("250"));
  });

  it("changes when the signature grants something else, even with the same review fingerprint", () => {
    const first = signatureKey(review());
    expect(signatureKey(review({ approvals: [approval(OTHER)] }))).not.toBe(first);
    expect(signatureKey(review({ approvals: [approval(BAD, "100")] }))).not.toBe(first);
    expect(signatureKey(review({ chainId: 1 }))).not.toBe(first);
  });

  it("tells recipients apart on a plain transfer", () => {
    const transfer = (to: string) => review({ approvals: [], decoded: { kind: "transaction", to: USDC, functionName: "transfer", args: [{ name: "to", type: "address", value: to }] } });
    expect(signatureKey(transfer(BAD))).not.toBe(signatureKey(transfer(OTHER)));
  });
});
