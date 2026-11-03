import { describe, expect, it } from "vitest";
import { z, type ZodType } from "zod";
import type { SigningReview } from "@dappdrill/core";
import { SigningReview as SigningReviewSchema } from "@dappdrill/core";
import { createSigningReviewer } from "../../src/signing/index.js";
import type { Llm, SigningInput } from "../../src/types.js";
import { FakeChain, fakeErc20, type FakeContract } from "./fake-chain.js";
import { BLOCKLISTS, fakeFetch, sourcifyVerified, type Routes } from "./fake-fetch.js";
import * as F from "./fixtures.js";

const HEAD = 1_000_000n;
const DAYS = (n: number) => BigInt(Math.round((n * 86_400) / 12));

/** Mainnet-shaped fake chain: USDC, Permit2, a verified vault, an unverified 3-day-old router, an EOA. */
function world(extra: Record<string, FakeContract> = {}) {
  return new FakeChain(1, {
    [F.USDC_MAINNET]: fakeErc20({ symbol: "USDC", name: "USD Coin", decimals: 6, totalSupply: 50_000_000_000n * 10n ** 6n, balances: { [F.WALLET]: F.usdc(1000) } }),
    [F.VAULT]: { createdAt: HEAD - DAYS(400) },
    [F.NEW_ROUTER]: { createdAt: HEAD - DAYS(3) },
    [F.PERMIT2_ADDRESS]: { createdAt: HEAD - DAYS(900) },
    [F.UNIVERSAL_ROUTER]: { createdAt: HEAD - DAYS(500) },
    ...extra,
  }, { head: HEAD });
}

const sourcify = (address: string, name: string) => ({ [`https://sourcify.dev/server/v2/contract/1/${address}`]: sourcifyVerified(name) });

function routes(extra: Routes = {}): Routes {
  return {
    ...BLOCKLISTS(),
    ...sourcify(F.USDC_MAINNET, "FiatTokenProxy"),
    ...sourcify(F.VAULT, "HarborVault"),
    ...sourcify(F.PERMIT2_ADDRESS, "Permit2"),
    ...sourcify(F.UNIVERSAL_ROUTER, "UniversalRouter"),
    ...extra,
  };
}

function reviewer(extra: Routes = {}) {
  return createSigningReviewer({ fetch: fakeFetch(routes(extra)), lookupTimeoutMs: 3000 });
}

function input(request: SigningInput["request"], ui: SigningInput["ui"], rest: Partial<SigningInput> = {}): SigningInput {
  return { request, chains: world(), ui: { pageUrl: "https://app.harborvault.xyz/deposit", ...ui }, baselines: {}, ...rest };
}

const check = (r: SigningReview, id: SigningReview["checks"][number]["id"]) => r.checks.find((c) => c.id === id)!;

describe("signing reviewer", () => {
  it("unlimited approval to a verified, old contract behind a vague button → check", async () => {
    const r = await reviewer().review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.PERMIT2_ADDRESS, F.UNLIMITED)), { buttonLabel: "Approve USDC" }));
    expect(SigningReviewSchema.parse(r)).toBeTruthy();
    expect(r.verdict).toBe("check");
    expect(r.title).toBe("Approve USDC for Permit2 (Uniswap)");
    expect(r.approvals[0]).toMatchObject({ unlimited: true, spenderName: "Permit2 (Uniswap)" });
    expect(check(r, "approval").status).toBe("warn");
    expect(check(r, "verified-source").status).toBe("pass");
    expect(check(r, "ui-match").status).toBe("pass");
    expect(r.explanation).toMatch(/Unlimited approval/);
    expect(r.advice).toMatch(/Limit the approval/);
    expect(JSON.stringify(r)).not.toMatch(/\bsafe\b/i);
  });

  it("approval to a wallet address → dangerous", async () => {
    const r = await reviewer().review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.EOA_SPENDER, F.usdc(100))), { buttonLabel: "Approve 100 USDC" }));
    expect(r.verdict).toBe("dangerous");
    expect(check(r, "approval")).toMatchObject({ status: "fail" });
    expect(r.explanation).toMatch(/Don't ship this\. Approval to a wallet address/);
    expect(r.summary).toBe(`The button says “Approve 100 USDC”. The wallet is asked to approve 100 USDC for ${"0x2222…2222"}, a wallet address rather than a contract.`);
  });

  it("'Approve 100 USDC' with an exact approval to a known contract → consistent", async () => {
    const r = await reviewer().review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.PERMIT2_ADDRESS, F.usdc(100))), { buttonLabel: "Approve 100 USDC" }));
    expect(r.verdict).toBe("consistent");
    expect(r.checks.filter((c) => c.status === "fail" || c.status === "warn")).toEqual([]);
    expect(check(r, "token").detail).toBe("The real USDC on Ethereum, verified.");
    expect(check(r, "known-bad").status).toBe("pass");
    expect(r.advice).toBeUndefined();
  });

  it("unlimited approval where the button says 250, to an unverified 3-day-old spender → dangerous with the mockup's reasons", async () => {
    const r = await reviewer().review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.NEW_ROUTER, F.UNLIMITED)), { buttonLabel: "Approve 250 USDC" }));
    expect(r.verdict).toBe("dangerous");
    expect(r.explanation).toContain("Unlimited approval to an unverified, 3-day-old spender");
    expect(r.explanation).toContain("Unlimited where the UI shows 250");
    expect(check(r, "contract-age")).toMatchObject({ status: "warn" });
    expect(check(r, "contract-age").detail).toMatch(/deployed 3 days ago — new/);
    expect(check(r, "verified-source")).toMatchObject({ status: "fail" });
    expect(r.summary).toMatch(/approve unlimited USDC for 0x4444…4444, a contract with no verified source that was deployed 3 days ago/);
  });

  it("Permit2 permit presented as 'Sign in' → dangerous", async () => {
    const td = F.permit2Single(F.USDC_MAINNET, F.UNIVERSAL_ROUTER, F.PERMIT2_UNLIMITED, 1_900_000_000);
    const r = await reviewer().review(input(F.signRequest("eth_signTypedData_v4", [F.WALLET, JSON.stringify(td)]), { buttonLabel: "Sign in" }));
    expect(r.verdict).toBe("dangerous");
    expect(r.decoded).toMatchObject({ kind: "typedData", primaryType: "PermitSingle", to: F.PERMIT2_ADDRESS });
    expect(r.approvals[0]).toMatchObject({ standard: "permit2", unlimited: true, spender: F.UNIVERSAL_ROUTER });
    expect(check(r, "ui-match")).toMatchObject({ status: "fail" });
    expect(r.title).toBe("Permit USDC for Uniswap Universal Router");
  });

  it("SIWE sign-in for the page's own domain → consistent; for another domain → check", async () => {
    const ok = await reviewer().review(input(F.signRequest("personal_sign", [`0x${Buffer.from(F.siweMessage("app.harborvault.xyz")).toString("hex")}`, F.WALLET]), { buttonLabel: "Sign in" }));
    expect(ok.verdict).toBe("consistent");
    expect(ok.title).toBe("Sign in to app.harborvault.xyz");
    expect(check(ok, "simulation").status).toBe("skip");

    const bad = await reviewer().review(input(F.signRequest("personal_sign", [`0x${Buffer.from(F.siweMessage("evil.example")).toString("hex")}`, F.WALLET]), { buttonLabel: "Sign in" }));
    expect(bad.verdict).toBe("check");
    expect(check(bad, "ui-match").detail).toMatch(/evil\.example.*app\.harborvault\.xyz/);
  });

  it("generic typed data behind a 'Vote' button → consistent", async () => {
    const r = await reviewer().review(input(F.signRequest("eth_signTypedData_v4", [F.WALLET, F.genericTypedData()]), { buttonLabel: "Vote" }), );
    expect(r.decoded.primaryType).toBe("Vote");
    expect(r.approvals).toEqual([]);
    expect(check(r, "ui-match").status).toBe("unverified");
    expect(r.verdict).toBe("check");
  });

  it("a junk selector degrades to raw calldata and a check verdict", async () => {
    const r = await reviewer().review(input(F.txRequest(F.VAULT, F.JUNK_DATA), { buttonLabel: "Do the thing" }));
    expect(r.verdict).toBe("check");
    expect(r.decoded).toMatchObject({ functionName: undefined, calldata: F.JUNK_DATA, abiSource: "none" });
    expect(r.title).toMatch(/^Send 0 ETH to HarborVault$/);
  });

  it("never throws, even for nonsense", async () => {
    const r = await reviewer().review({ request: { ...F.signRequest("eth_signTypedData_v4", [42, null]), chainId: 999 }, chains: world(), ui: {}, baselines: {} });
    expect(r.verdict).toBe("check");
    expect(SigningReviewSchema.parse(r)).toBeTruthy();
  });

  it("known-bad address → dangerous", async () => {
    const rv = createSigningReviewer({ fetch: fakeFetch(routes(BLOCKLISTS({ addresses: [F.VAULT.toLowerCase()] }))), lookupTimeoutMs: 3000 });
    const r = await rv.review(input(F.txRequest(F.USDC_MAINNET, F.transferData(F.VAULT, F.usdc(1))), { buttonLabel: "Send 1 USDC" }));
    expect(r.verdict).toBe("dangerous");
    expect(check(r, "known-bad")).toMatchObject({ status: "fail" });
  });

  it("known-bad domain → dangerous; unavailable lists → unverified", async () => {
    const rv = createSigningReviewer({ fetch: fakeFetch(routes(BLOCKLISTS({ domains: ["harborvault.xyz"] }))), lookupTimeoutMs: 3000 });
    const r = await rv.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.usdc(1))), { buttonLabel: "Approve 1 USDC" }));
    expect(r.verdict).toBe("dangerous");
    expect(check(r, "known-bad").detail).toMatch(/harborvault\.xyz/);

    const offline = createSigningReviewer({ fetch: fakeFetch({ ...sourcify(F.VAULT, "HarborVault"), ...sourcify(F.USDC_MAINNET, "FiatTokenProxy") }), lookupTimeoutMs: 3000 });
    const r2 = await offline.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.usdc(1))), { buttonLabel: "Approve 1 USDC" }));
    expect(check(r2, "known-bad").status).toBe("unverified");
    expect(r2.verdict).toBe("check");
  });

  it("baseline diff: the spender changed since the accepted run", async () => {
    const rv = reviewer();
    const first = await rv.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.PERMIT2_ADDRESS, F.usdc(250))), { buttonLabel: "Approve 250 USDC" }, { flow: { id: "flw_1", name: "Deposit", stepIndex: 2, params: {} } }));
    expect(first.verdict).toBe("consistent");
    const second = await rv.review(
      input(F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.usdc(250))), { buttonLabel: "Approve 250 USDC" }, { flow: { id: "flw_1", name: "Deposit", stepIndex: 2, params: {} }, baselines: { [first.fingerprint]: first } }),
    );
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.verdict).toBe("check");
    expect(second.baseline?.changes).toEqual([{ field: "spender", before: F.PERMIT2_ADDRESS.toLowerCase(), after: F.VAULT.toLowerCase() }]);
    expect(check(second, "baseline")).toMatchObject({ status: "warn" });
    expect(check(second, "baseline").detail).toMatch(/Permit2/);
    expect(second.explanation).toContain("Different spender from the last run");
  });

  it("flow expectation: amounts with params, unlimited, spender, and Permit2 acceptance", async () => {
    const flow = (expectation: NonNullable<SigningInput["flow"]>["expectation"], params = { amount: "100" }) => ({ id: "flw_2", name: "Deposit", stepIndex: 1, expectation, params });
    const rv = reviewer();
    const ok = await rv.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.usdc(100))), { buttonLabel: "Approve 100 USDC" }, { flow: flow({ functionName: "approve", spenderMustBe: F.VAULT, amountMustEqual: "{{amount}}", failIfUnlimited: true }) }));
    expect(check(ok, "expectation")).toMatchObject({ status: "pass" });
    expect(ok.verdict).toBe("consistent");

    const wrongAmount = await rv.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.usdc(250))), { buttonLabel: "Approve" }, { flow: flow({ amountMustEqual: "{{amount}}" }) }));
    expect(check(wrongAmount, "expectation").detail).toMatch(/expected amount 100, got 250/);
    expect(wrongAmount.verdict).toBe("check");

    const unlimited = await rv.review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.UNLIMITED)), { buttonLabel: "Approve" }, { flow: flow({ failIfUnlimited: true }) }));
    expect(check(unlimited, "expectation").detail).toMatch(/unlimited/);

    const permit2 = await rv.review(
      input(F.signRequest("eth_signTypedData_v4", [F.WALLET, F.permit2Single(F.USDC_MAINNET, F.VAULT, F.usdc(100), 1_900_000_000)]), { buttonLabel: "Approve 100 USDC" }, { flow: flow({ kind: "transaction", functionName: "approve", spenderMustBe: F.VAULT, amountMustEqual: "100", alsoAcceptPermit2: true }) }),
    );
    expect(check(permit2, "expectation")).toMatchObject({ status: "pass" });
  });

  it("uses the model for labels the rules can't settle", async () => {
    const llm = (answer: { matches: boolean; confidence: "high" | "medium" | "low"; reason: string }): Llm & { prompts: string[] } => {
      const prompts: string[] = [];
      return {
        backend: "api",
        prompts,
        runAgent: async () => ({ text: "" }),
        async structured<T>(opts: { prompt: string; schema: ZodType<T>; name: string }): Promise<T> {
          prompts.push(opts.prompt);
          expect(opts.name).toBe("ui_match");
          return opts.schema.parse(answer);
        },
        costUsd: () => 0,
      };
    };
    const req = F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.usdc(100)));

    const no = llm({ matches: false, confidence: "high", reason: "The page talks about staking HARB, not approving USDC." });
    const r1 = await reviewer().review(input(req, { buttonLabel: "Continue", context: "Stake HARB to earn rewards" }, { llm: no }));
    expect(no.prompts[0]).toContain("Button label: Continue");
    expect(no.prompts[0]).toContain("Grants: 100 USDC of USDC to HarborVault");
    expect(check(r1, "ui-match")).toMatchObject({ status: "fail", detail: "The page talks about staking HARB, not approving USDC." });
    expect(r1.verdict).toBe("dangerous");

    const yes = llm({ matches: true, confidence: "high", reason: "The page shows a 100 USDC deposit; approving it first is expected." });
    const r2 = await reviewer().review(input(req, { buttonLabel: "Continue" }, { llm: yes }));
    expect(check(r2, "ui-match")).toMatchObject({ status: "pass" });
    expect(r2.verdict).toBe("consistent");

    // The rules already found an exact match: the model can only soften that to a warning.
    const contrary = llm({ matches: false, confidence: "high", reason: "Looks off." });
    const r3 = await reviewer().review(input(req, { buttonLabel: "Approve 100 USDC" }, { llm: contrary }));
    expect(check(r3, "ui-match").status).toBe("warn");
    expect(r3.verdict).toBe("check");
  });

  it("wallet_sendCalls batches are decoded call by call", async () => {
    const req = F.signRequest("wallet_sendCalls", [{ from: F.WALLET, chainId: "0x1", calls: [{ to: F.USDC_MAINNET, data: F.approveData(F.VAULT, F.usdc(50)) }, { to: F.VAULT, data: F.depositData(), value: "0x0" }] }]);
    const r = await reviewer().review(input(req, { buttonLabel: "Deposit 50 USDC" }));
    expect(r.decoded.args.some((a) => a.type === "call" && (a.display ?? "").startsWith("deposit("))).toBe(true);
    expect(r.approvals[0]).toMatchObject({ amount: F.usdc(50).toString() });
    expect(r.title).toMatch(/\(\+1 more\)$/);
  });

  it("zod: the review validates against the core schema", async () => {
    const r = await reviewer().review(input(F.txRequest(F.USDC_MAINNET, F.approveData(F.VAULT, F.usdc(1))), {}));
    expect(() => SigningReviewSchema.parse(r)).not.toThrow();
    expect(z.string().parse(r.id)).toMatch(/^sgr_/);
  });
});
