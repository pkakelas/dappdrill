import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CheckAssert, WalletRequest } from "@dappdrill/core";
import { agrees, evaluateCheck } from "../../src/explore/checks.js";
import type { DrillSession } from "../../src/types.js";
import { createStubSession, type StubSession } from "../agent/fixture/session.js";

vi.mock("../../src/explore/prices.js", () => ({
  referencePrices: async (asset: string) => (asset === "ETH" ? [{ usd: 3365, source: "Coinbase" }] : []),
}));

const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const PAGE = `
  <h1>Swap</h1>
  <p>Balance</p><p>1,000.5 USDC</p>
  <p>You pay 0.5 ETH</p><p>1 ETH = $3,365.12</p><p>You receive 1,682.56 USDC</p>
  <input value="0.5" />`;

let stub: StubSession;
let requests: WalletRequest[] = [];
/** What the chain says: the wallet's native and token balance, and how the last transaction went. */
let chain = { native: 2n * 10n ** 18n, token: 1_000_500_000n, receipt: "success" };

beforeAll(async () => {
  stub = await createStubSession();
  vi.spyOn(stub.wallet, "requests").mockImplementation(() => requests);
});
afterAll(async () => {
  await stub?.close();
});

function session(): DrillSession {
  const client = {
    getBalance: async () => chain.native,
    readContract: async ({ functionName }: { functionName: string }) => (functionName === "decimals" ? 6 : chain.token),
    waitForTransactionReceipt: async () => ({ status: chain.receipt, blockNumber: 7n }),
  };
  return { ...stub, page: stub.page, chains: { client: () => client } } as unknown as DrillSession;
}

async function check(assert: CheckAssert, html = PAGE, since = 0) {
  await stub.page.setContent(html);
  return evaluateCheck(session(), assert, since);
}

const sign = (over: Partial<WalletRequest>): WalletRequest => ({ id: "r", method: "personal_sign", chainId: 31337, kind: "sign", at: "", outcome: "approved", params: ["Sign in to Harbor", WALLET], ...over }) as WalletRequest;
const send = (over: Partial<WalletRequest> = {}) => sign({ method: "eth_sendTransaction", params: [{ from: WALLET, to: RECIPIENT, data: `0xdeadbeef${"0".repeat(24)}${"2".repeat(40)}`, value: "0x0" }], result: HASH, ...over });

describe("evaluateCheck", () => {
  it("says a check that names nothing couldn't be made", async () => {
    for (const kind of ["shows", "hides", "url", "balance", "price", "adds-up"] as const) expect((await check({ kind })).status).toBe("error");
    expect((await check({ kind: "price", value: "$3,365.12" })).evidence).toContain("which asset");
  });

  it("reads the page the way a person does: across elements, in fields, with or without separators", async () => {
    expect(await check({ kind: "shows", value: "You pay 0.5 ETH" })).toMatchObject({ status: "pass" });
    expect(await check({ kind: "shows", value: "Balance 1000.5 USDC" })).toMatchObject({ status: "pass" });
    expect(await check({ kind: "shows", value: "Insufficient balance" })).toMatchObject({ status: "fail" });
    expect(await check({ kind: "hides", value: "Insufficient balance" })).toMatchObject({ status: "pass" });
    expect(await check({ kind: "hides", value: "You receive 1,682.56 USDC" })).toMatchObject({ status: "fail" });
  }, 30_000);

  it("leaves out what the page holds but doesn't show", async () => {
    const html = `<p style="display:none">Secret</p><input type="hidden" value="token-123" /><input type="password" value="hunter2" /><p>Shown</p>`;
    for (const value of ["Secret", "token-123", "hunter2"]) expect(await check({ kind: "shows", value }, html)).toMatchObject({ status: "fail" });
  }, 30_000);

  it("checks the address", async () => {
    await stub.page.goto(`${stub.baseUrl}/vault.html`);
    expect(await evaluateCheck(session(), { kind: "url", value: "/vault" })).toMatchObject({ status: "pass" });
    expect(await evaluateCheck(session(), { kind: "url", value: "/earn" })).toMatchObject({ status: "fail" });
  });

  it("matches what the wallet was asked by its summary, then by the request's own data", async () => {
    requests = [];
    expect(await check({ kind: "wallet", value: "Sign in" })).toMatchObject({ status: "fail", evidence: "Nothing was asked to sign on this path." });
    requests = [sign({}), send()];
    expect(await check({ kind: "wallet", value: "sign in to harbor" })).toMatchObject({ status: "pass" });
    expect((await check({ kind: "wallet" })).evidence).toContain("eth_sendTransaction");
    // An address inside calldata we couldn't decode isn't in the summary.
    const inData = await check({ kind: "wallet", value: `0x${"2".repeat(40)}` });
    expect(inData.status).toBe("pass");
    expect(inData.evidence).toContain("in its data");
    expect(await check({ kind: "wallet", value: `0x${"3".repeat(40)}` })).toMatchObject({ status: "fail" });
    expect(await check({ kind: "wallet", value: "Permit" })).toMatchObject({ status: "fail" });
  });

  it("counts only this path's requests, and only signing ones", async () => {
    requests = [sign({}), { ...sign({}), kind: "connect", method: "eth_requestAccounts" } as WalletRequest];
    expect(await check({ kind: "no-wallet" })).toMatchObject({ status: "fail" });
    expect(await check({ kind: "no-wallet" }, PAGE, 1)).toMatchObject({ status: "pass" });
    expect(await check({ kind: "wallet" }, PAGE, 1)).toMatchObject({ status: "fail" });
  });

  it("wants a mined transaction, not a signature or a rejected request", async () => {
    requests = [sign({ result: `0x${"cd".repeat(65)}` }), send({ outcome: "rejected", result: undefined })];
    expect(await check({ kind: "tx" })).toMatchObject({ status: "fail", evidence: "No transaction was sent on this path." });
    requests = [send()];
    expect((await check({ kind: "tx" })).evidence).toMatch(/^Transaction 0xabababab… was mined in block 7/);
    chain = { ...chain, receipt: "reverted" };
    expect(await check({ kind: "tx" })).toMatchObject({ status: "fail" });
    chain = { ...chain, receipt: "success" };
  });

  it("compares a balance with the chain to the digits the page shows", async () => {
    expect(await check({ kind: "balance", value: "1,000.5", token: RECIPIENT })).toMatchObject({ status: "pass" });
    chain = { ...chain, token: 990_000_000n };
    expect(await check({ kind: "balance", value: "1,000.5", token: RECIPIENT })).toMatchObject({ status: "fail", evidence: "The page shows 1,000.5, but the chain says 990." });
    // The native coin, and a number the page doesn't show: nothing to compare, so not the app's failure.
    expect(await check({ kind: "balance", value: "2" }, "<p>2 ETH</p>")).toMatchObject({ status: "pass" });
    expect(await check({ kind: "balance", value: "7.25" })).toMatchObject({ status: "error" });
  });

  it("compares a price with the market, and calls the market's number unconfirmed", async () => {
    const near = await check({ kind: "price", value: "$3,365.12", token: "ETH" });
    expect(near.status).toBe("pass");
    expect(near.evidence).toContain("not confirmed on the fork");
    expect(await check({ kind: "price", value: "$3,365.12", token: "ETH" }, PAGE.replace("3,365.12", "3,362.90"))).toMatchObject({ status: "pass" });
    const far = await check({ kind: "price", value: "$2,100.00", token: "ETH" }, "<p>1 ETH = $2,100.00</p>");
    expect(far.status).toBe("fail");
    expect(far.evidence).toContain("% apart");
    expect(await check({ kind: "price", value: "$9.99", token: "ETH" })).toMatchObject({ status: "error" });
    expect(await check({ kind: "price", value: "$3,365.12", token: "NOSUCH" })).toMatchObject({ status: "error", evidence: "No market price for NOSUCH to compare with." });
  });

  it("does the sum on the page's own numbers", async () => {
    expect(await check({ kind: "adds-up", value: "0.5 * 3,365.12 = 1,682.56" })).toMatchObject({ status: "pass" });
    expect(await check({ kind: "adds-up", value: "0.5 * 3,365.12 = 1,582.56" }, PAGE.replace("1,682.56", "1,582.56"))).toMatchObject({ status: "fail" });
    expect(await check({ kind: "adds-up", value: "0.5 * 3,400 = 1,700" })).toMatchObject({ status: "error" });
  });

  it("finds a value the code failed to produce", async () => {
    expect(await check({ kind: "well-formed" })).toMatchObject({ status: "pass" });
    expect((await check({ kind: "well-formed" }, "<p>APY: NaN%</p>")).status).toBe("fail");
  });

  it("calls a check that threw an error, not a failure", async () => {
    requests = [send()];
    const broken = { ...session(), chains: { client: () => ({ waitForTransactionReceipt: async () => Promise.reject(new Error("timed out\nat x")) }) } } as unknown as DrillSession;
    await stub.page.setContent(PAGE);
    expect(await evaluateCheck(broken, { kind: "tx" })).toEqual({ status: "error", evidence: "Couldn't make the check: timed out" });
  });
});

describe("agrees", () => {
  it("allows the rounding of the digits shown, and no more", () => {
    expect(agrees("1,000.50", "1000.4999")).toBe(true);
    expect(agrees("1,000.50", "1000.5049")).toBe(true);
    expect(agrees("1,000.50", "1000.52")).toBe(false);
    expect(agrees("12", "12.9")).toBe(true);
    expect(agrees("12", "13.1")).toBe(false);
    expect(agrees("$0.00", "0.004")).toBe(true);
  });
});
