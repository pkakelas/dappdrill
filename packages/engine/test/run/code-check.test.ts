import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CodeCheck, type Check, type WalletRequest } from "@dappdrill/core";
import { checkByCode, movedBy, unreadBefore, type Reading } from "../../src/run/code-check.js";
import type { Running } from "../../src/run/running.js";
import { createStubSession, type StubSession } from "../agent/fixture/session.js";

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

/** A portfolio the way trading apps build one: figures under labels, and a table of positions. */
const PORTFOLIO = `
  <main>
    <h1>Portfolio</h1>
    <div><span>Cash</span><span>$1,000.00</span></div>
    <div><span>Unrealized P&amp;L</span><span>-$12.50</span></div>
    <div><span>Portfolio value</span><span>$987.50</span></div>
    <div><span>Holdings</span><span>2</span></div>
    <table>
      <thead><tr><th>Asset</th><th>Size</th><th>Worth</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr><td>Apple</td><td>0.5</td><td>$100.00</td><td>Open</td><td><button>Cancel</button></td></tr>
        <tr><td>Tesla</td><td>2</td><td>$250.25</td><td>Filled</td><td><button disabled>Cancel</button></td></tr>
      </tbody>
    </table>
    <button>Deposit</button>
    <button disabled>Withdraw</button>
  </main>`;
const DIALOG = `<div role="dialog"><h2>Withdraw</h2><div><span>Available</span><span>$400.00</span></div><ul><li>Order 1 <span>Open</span></li></ul><button>Confirm</button></div>`;

describe("a check by code, on a page", () => {
  let s: StubSession;
  /** What the page showed since the latest action and may have taken away. */
  let said: string[];
  /** A transaction's receipt, or none when it isn't mined. */
  let receipt: { status: "success" | "reverted"; blockNumber: bigint } | undefined;

  beforeAll(async () => {
    s = await createStubSession();
    await s.page.goto(s.baseUrl);
  }, 60_000);
  afterAll(async () => {
    await s?.close();
  });
  beforeEach(async () => {
    said = [];
    receipt = undefined;
    s.wallet.requests().length = 0;
    await s.page.setContent(PORTFOLIO);
  });

  const running = (more: Partial<Running> = {}) => {
    // One token answers for its units, as a chain would; any other address isn't a token.
    const readContract = async ({ address, functionName }: { address: string; functionName: string }) => (address === USDC && functionName !== "asset" ? (functionName === "decimals" ? 6 : "USDC") : Promise.reject(new Error("reverted")));
    const chains = { client: () => ({ readContract, waitForTransactionReceipt: async () => receipt ?? Promise.reject(new Error("timed out")) }) };
    return { session: { ...s, chains, said: { since: () => said } }, steps: [], since: 0, acted: Date.now(), before: new Map(), ...more } as unknown as Running;
  };
  /** How a check comes out, read once unless it says how long to wait. */
  const decided = async (expected: object, more: Partial<Running> = {}) => {
    const check = CodeCheck.parse({ type: "check", by: "code", claim: "It is so.", expect: { wait: 0, ...expected } });
    const { status, note, by } = await checkByCode(running(more), check);
    expect(by).toBe("code");
    return { status, note };
  };
  const status = async (expected: object, more: Partial<Running> = {}) => (await decided(expected, more)).status;
  const asked = (method: string, params: unknown, outcome: WalletRequest["outcome"], result?: string) =>
    void s.wallet.requests().push({ id: `r${s.wallet.requests().length}`, method, params, chainId: 31337, kind: "sign", at: "now", outcome, result });
  const SPENDER = "0x1111111111111111111111111111111111111111";
  const USDC = "0x3333333333333333333333333333333333333333";
  const permit = (value: string, verifyingContract?: string) => [s.wallet.address(), JSON.stringify({ primaryType: "Permit", domain: { name: "USD Coin", verifyingContract }, types: {}, message: { owner: s.wallet.address(), spender: SPENDER, value } })];

  describe("shows and hides", () => {
    it("reads the page the way a person does, across elements", async () => {
      expect(await decided({ kind: "shows", text: "Apple 0.5 $100.00" })).toEqual({ status: "pass", note: "Shows “Apple 0.5 $100.00” on the page." });
      expect(await status({ kind: "shows", text: "$1000.00" })).toBe("pass");
      expect(await decided({ kind: "shows", text: "Margin" })).toEqual({ status: "fail", note: "“Margin” isn't on the page." });
      expect(await status({ kind: "hides", text: "Margin" })).toBe("pass");
      expect(await status({ kind: "hides", text: "Tesla" })).toBe("fail");
    });

    it("reads only the row that holds a text", async () => {
      expect(await decided({ kind: "shows", text: "Open", row: "Apple" })).toEqual({ status: "pass", note: "Shows “Open” in the row with “Apple”." });
      expect(await decided({ kind: "shows", text: "Open", row: "Tesla" })).toEqual({ status: "fail", note: "“Open” isn't in the row with “Tesla”." });
      expect(await status({ kind: "hides", text: "Open", row: "Tesla" })).toBe("pass");
      expect(await status({ kind: "hides", text: "Open", row: "Apple" })).toBe("fail");
    });

    it("takes a row that is gone as hiding whatever it said, and as showing nothing", async () => {
      expect(await decided({ kind: "hides", text: "Open", row: "Nvidia" })).toEqual({ status: "pass", note: "No row holds “Nvidia”." });
      expect(await decided({ kind: "shows", text: "Open", row: "Nvidia" })).toEqual({ status: "fail", note: "No row holds “Nvidia”." });
    });

    it("reads only the open dialog, and a row inside it", async () => {
      expect(await decided({ kind: "shows", text: "Available", dialog: true })).toEqual({ status: "fail", note: "No dialog or menu is open." });
      await s.page.setContent(PORTFOLIO + DIALOG);
      expect(await status({ kind: "shows", text: "Available", dialog: true })).toBe("pass");
      expect(await status({ kind: "shows", text: "Tesla", dialog: true })).toBe("fail");
      expect(await status({ kind: "shows", text: "Open", dialog: true, row: "Order 1" })).toBe("pass");
      expect(await status({ kind: "hides", text: "Filled", dialog: true })).toBe("pass");
    });

    it("keeps looking for as long as it says", async () => {
      await s.page.evaluate(() => void setTimeout(() => document.body.append("Order filled"), 500));
      expect(await status({ kind: "shows", text: "Order filled" })).toBe("fail");
      expect(await status({ kind: "shows", text: "Order filled", wait: 5 })).toBe("pass");
    });
  });

  it("said: on the page now, or shown since the latest action and gone", async () => {
    said = ["Withdrawal sent", "Fetching…"];
    expect(await decided({ kind: "said", text: "Deposit" })).toEqual({ status: "pass", note: "Shows “Deposit”." });
    expect(await decided({ kind: "said", text: "withdrawal sent" })).toEqual({ status: "pass", note: "The page said “withdrawal sent”." });
    expect(await decided({ kind: "said", text: "Order placed" })).toEqual({ status: "fail", note: "The page didn't say “Order placed”. It said: “Withdrawal sent”, “Fetching…”." });
  });

  it("url: a part of the address", async () => {
    expect(await status({ kind: "url", contains: new URL(s.baseUrl).host })).toBe("pass");
    expect((await decided({ kind: "url", contains: "/orders" })).note).toMatch(/^The address is http.*, without “\/orders”\.$/);
  });

  it("button: offered and usable, or greyed out, on the page or in one row", async () => {
    expect(await decided({ kind: "button", name: "Deposit", is: "enabled" })).toEqual({ status: "pass", note: "“Deposit” on the page is enabled." });
    expect(await decided({ kind: "button", name: "Withdraw", is: "enabled" })).toEqual({ status: "fail", note: "“Withdraw” on the page is disabled." });
    expect(await status({ kind: "button", name: "Withdraw", is: "disabled" })).toBe("pass");
    expect(await status({ kind: "button", name: "Cancel", is: "disabled", row: "Tesla" })).toBe("pass");
    expect(await status({ kind: "button", name: "Cancel", is: "disabled", row: "Apple" })).toBe("fail");
    expect(await decided({ kind: "button", name: "Bridge", is: "enabled" })).toEqual({ status: "fail", note: "No “Bridge” on the page. The buttons there: “Cancel”, “Deposit”, “Withdraw”." });
    expect(await decided({ kind: "button", name: "Cancel", is: "enabled", row: "Nvidia" })).toEqual({ status: "fail", note: "No row holds “Nvidia”." });
  });

  describe("signed and not-signed", () => {
    it("reads what the wallet was asked, and how the request ended", async () => {
      expect(await decided({ kind: "signed", holds: "Permit" })).toEqual({ status: "fail", note: "The wallet wasn't asked to sign anything." });
      expect(await decided({ kind: "not-signed" })).toEqual({ status: "pass", note: "The wallet wasn't asked to sign anything." });
      asked("eth_signTypedData_v4", permit("25000000"), "rejected");
      expect(await status({ kind: "signed", holds: "Permit" })).toBe("pass");
      expect(await status({ kind: "signed", holds: "Permit", was: "rejected" })).toBe("pass");
      expect((await decided({ kind: "signed", holds: "Permit", was: "approved" })).note).toBe("The wallet was asked to sign a Permit (USD Coin) that lets 0x1111…1111 spend 25000000, and it was rejected, not approved.");
      expect((await decided({ kind: "not-signed", holds: "Permit" })).note).toBe("The wallet was asked to sign a Permit (USD Coin) that lets 0x1111…1111 spend 25000000.");
      expect(await status({ kind: "signed", holds: "25000000" })).toBe("pass");
      expect(await status({ kind: "signed", holds: SPENDER })).toBe("pass");
      expect((await decided({ kind: "signed", holds: "Transfer" })).note).toMatch(/^Nothing the wallet was asked holds “Transfer”\. It was asked to sign a Permit /);
      expect(await status({ kind: "not-signed", holds: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" })).toBe("pass");
      expect(await status({ kind: "not-signed", holds: "Permit" })).toBe("fail");
      expect(await status({ kind: "not-signed" })).toBe("fail");
    });

    it("reads only what the latest action asked, with latest", async () => {
      asked("eth_sendTransaction", [{ to: SPENDER, data: "0x095ea7b3" }], "approved");
      asked("eth_signTypedData_v4", permit("25000000"), "approved");
      // The permit came with the latest action; the transaction before it.
      const at = { actedAt: 1 };
      expect(await status({ kind: "not-signed", holds: "0x095ea7b3" }, at)).toBe("fail");
      expect(await status({ kind: "not-signed", holds: "0x095ea7b3", latest: true }, at)).toBe("pass");
      expect(await status({ kind: "signed", holds: "Permit", latest: true }, at)).toBe("pass");
      expect(await status({ kind: "signed", holds: "0x095ea7b3", latest: true }, at)).toBe("fail");
      // Before any action there is nothing to narrow to: it reads the whole test.
      expect(await status({ kind: "signed", holds: "0x095ea7b3", latest: true })).toBe("pass");
    });

    it("says several facts about one request as an all", async () => {
      asked("eth_signTypedData_v4", permit("25000000"), "rejected");
      const amount = { kind: "all", of: [{ kind: "signed", holds: "Permit", was: "rejected" }, { kind: "signed", holds: "25000000" }, { kind: "not-signed", holds: "115792089237316195423570985008687907853269984665640564039457584007913129639935" }] };
      expect(await status(amount)).toBe("pass");
      s.wallet.requests().length = 0;
      asked("eth_signTypedData_v4", permit("115792089237316195423570985008687907853269984665640564039457584007913129639935"), "rejected");
      expect(await status(amount)).toBe("fail");
    });

    it("says an amount in the token's own units, when the chain says what they are", async () => {
      asked("eth_signTypedData_v4", permit("25000000", USDC), "approved");
      expect((await decided({ kind: "not-signed" })).note).toBe("The wallet was asked to sign a Permit (USD Coin) that lets 0x1111…1111 spend 25 USDC.");
      // The amount as the request has it still finds the request.
      expect(await status({ kind: "signed", holds: "25000000" })).toBe("pass");
    });

    it("leaves out what the wallet was asked before this began", async () => {
      asked("eth_signTypedData_v4", permit("25000000"), "approved");
      expect(await status({ kind: "not-signed" }, { since: 1 })).toBe("pass");
    });
  });

  it("mined: the transaction that was sent, by its receipt", async () => {
    const tx = [{ to: SPENDER, data: "0xdeadbeef00" }];
    expect(await decided({ kind: "mined" })).toEqual({ status: "fail", note: "No transaction was sent." });
    asked("eth_sendTransaction", tx, "rejected");
    expect((await decided({ kind: "mined" })).note).toBe("The wallet was asked to send 0x1111…1111 a call we can't read (0xdeadbeef), but nothing was sent.");
    asked("eth_sendTransaction", tx, "approved", `0x${"ab".repeat(32)}`);
    expect((await decided({ kind: "mined" })).note).toMatch(/^The transaction to send .* \(0xabababab…\) isn't mined yet\.$/);
    expect(await status({ kind: "mined" })).toBe("unsure");
    receipt = { status: "success", blockNumber: 7n };
    expect((await decided({ kind: "mined" })).note).toMatch(/ was mined in block 7\.$/);
    expect(await status({ kind: "mined", holds: "0xdeadbeef" })).toBe("pass");
    expect((await decided({ kind: "mined", holds: "approve" })).note).toMatch(/^No transaction that holds “approve” was sent\. It was asked to send /);
    receipt = { status: "reverted", blockNumber: 8n };
    expect(await decided({ kind: "mined" })).toMatchObject({ status: "fail", note: expect.stringMatching(/ reverted in block 8\.$/) });
  });

  describe("changes", () => {
    const before = (reading: Reading) => ({ before: new Map([["\nCash", reading]]) });

    it("compares a figure with what it was before the test began", async () => {
      expect(await decided({ kind: "changes", figure: "Cash", by: 100 }, before({ text: "900.00", value: 900 }))).toEqual({ status: "pass", note: "“Cash” went from 900.00 to 1000.00." });
      expect(await status({ kind: "changes", figure: "Cash", by: "-25.50" }, before({ text: "1,025.50", value: 1025.5 }))).toBe("pass");
      expect(await decided({ kind: "changes", figure: "Cash", by: 0 }, before({ text: "900.00", value: 900 }))).toEqual({ status: "fail", note: "“Cash” went from 900.00 to 1000.00: a change of 100, not 0." });
    });

    it("is unsure when the figure wasn't read before, or isn't there now", async () => {
      expect(await decided({ kind: "changes", figure: "Cash", by: 100 })).toEqual({ status: "unsure", note: "Before the test began: “Cash” wasn't read." });
      expect(await status({ kind: "changes", figure: "Cash", by: 100 }, before({ missing: "No figure labelled “Cash” on the page." }))).toBe("unsure");
      await s.page.setContent("<p>Loading</p>");
      expect(await decided({ kind: "changes", figure: "Cash", by: 100 }, before({ text: "900.00", value: 900 }))).toEqual({ status: "unsure", note: "No figure labelled “Cash” on the page." });
    });
  });

  describe("figures", () => {
    const cash = { label: "Cash" };

    it("compares a figure under a label with a number, either way", async () => {
      expect(await decided({ kind: "figures", left: cash, is: "equal", right: 1000 })).toEqual({ status: "pass", note: "“Cash” 1000.00 is equal to 1000." });
      expect(await decided({ kind: "figures", left: cash, is: "equal", right: 1001 })).toEqual({ status: "fail", note: "“Cash” 1000.00 is not equal to 1001: they are 1 apart." });
      expect(await status({ kind: "figures", left: 900000, is: "more", right: cash })).toBe("pass");
      expect(await status({ kind: "figures", left: cash, is: "less", right: 1000 })).toBe("fail");
      expect(await status({ kind: "figures", left: cash, is: "at-most", right: 1000 })).toBe("pass");
      expect(await status({ kind: "figures", left: cash, is: "at-least", right: "1000.01" })).toBe("fail");
      expect(await status({ kind: "figures", left: { label: "Unrealized P&L" }, is: "less", right: 0 })).toBe("pass");
    });

    it("allows what within says, as a number or as a share of the right side", async () => {
      expect(await status({ kind: "figures", left: cash, is: "equal", right: 1001, within: 2 })).toBe("pass");
      expect(await status({ kind: "figures", left: cash, is: "equal", right: 1004, within: 2 })).toBe("fail");
      expect(await decided({ kind: "figures", left: cash, is: "equal", right: 1004, within: "0.5%" })).toEqual({ status: "pass", note: "“Cash” 1000.00 is equal to 1004 (within 0.5%)." });
      expect(await status({ kind: "figures", left: cash, is: "at-least", right: 1004, within: "0.5%" })).toBe("pass");
      expect(await status({ kind: "figures", left: cash, is: "at-least", right: 1010, within: "0.5%" })).toBe("fail");
    });

    it("adds up and multiplies figures of the page", async () => {
      expect(await decided({ kind: "figures", left: { label: "Portfolio value" }, is: "equal", right: { add: [cash, { label: "Unrealized P&L" }] } })).toEqual({
        status: "pass",
        note: "“Portfolio value” 987.50 is equal to “Cash” 1000.00 + “Unrealized P&L” -12.50 = 987.5.",
      });
      expect(await status({ kind: "figures", left: { multiply: [{ column: "Size", row: "Apple" }, 200] }, is: "equal", right: { column: "Worth", row: "Apple" } })).toBe("pass");
      expect(await status({ kind: "figures", left: { multiply: [{ column: "Size", row: "Tesla" }, 200] }, is: "equal", right: { column: "Worth", row: "Tesla" }, within: "1%" })).toBe("fail");
    });

    it("reads a table down a column: one row's cell, the sum, the number of rows", async () => {
      expect(await decided({ kind: "figures", left: { column: "Worth", row: "Tesla" }, is: "equal", right: 250.25 })).toEqual({ status: "pass", note: "“Worth” 250.25 is equal to 250.25." });
      expect(await decided({ kind: "figures", left: { column: "Worth", all: "sum" }, is: "equal", right: 350.25 })).toEqual({ status: "pass", note: "“Worth” over 2 rows 350.25 is equal to 350.25." });
      expect(await decided({ kind: "figures", left: { label: "Holdings" }, is: "equal", right: { column: "Worth", all: "count" } })).toEqual({ status: "pass", note: "“Holdings” 2 is equal to 2 rows under “Worth”." });
      expect(await decided({ kind: "figures", left: { row: "Open", all: "count" }, is: "equal", right: 1 })).toEqual({ status: "pass", note: "1 row with “Open” is equal to 1." });
      expect(await status({ kind: "figures", left: { row: "Cancelled", all: "count" }, is: "equal", right: 0 })).toBe("pass");
    });

    it("reads a figure inside the open dialog, or inside one row", async () => {
      await s.page.setContent(PORTFOLIO + DIALOG);
      expect(await status({ kind: "figures", left: { label: "Available", dialog: true }, is: "at-most", right: cash })).toBe("pass");
      expect(await status({ kind: "figures", left: { row: "Open", all: "count", dialog: true }, is: "equal", right: 1 })).toBe("pass");
      expect(await decided({ kind: "figures", left: { label: "Apple", row: "Apple" }, is: "equal", right: 0.5 })).toEqual({ status: "pass", note: "“Apple” 0.5 is equal to 0.5." });
    });

    it("is unsure, never failed, when a figure it needs can't be read", async () => {
      expect(await decided({ kind: "figures", left: { label: "Buying power" }, is: "equal", right: 1000 })).toEqual({
        status: "unsure",
        note: "No figure labelled “Buying power” on the page. The figures on it are labelled “Cash”, “Unrealized P&L”, “Portfolio value”, “Holdings”, “Apple”, “Tesla”.",
      });
      expect(await decided({ kind: "figures", left: cash, is: "equal", right: { label: "Available", dialog: true } })).toEqual({ status: "unsure", note: "No dialog or menu is open." });
      expect(await decided({ kind: "figures", left: { column: "Fee", all: "sum" }, is: "equal", right: 0 })).toEqual({ status: "unsure", note: "No column headed “Fee” on the page." });
      expect(await decided({ kind: "figures", left: { column: "Worth", row: "Nvidia" }, is: "equal", right: 0 })).toEqual({ status: "unsure", note: "No row under “Worth” holds “Nvidia”." });
      expect(await decided({ kind: "figures", left: { column: "Status", all: "sum" }, is: "equal", right: 0 })).toEqual({ status: "unsure", note: "Under “Status” a row reads “Open”, which isn't a figure." });
      expect(await decided({ kind: "figures", left: { label: "Cancel", row: "Cancel" }, is: "equal", right: 0 })).toEqual({ status: "unsure", note: "2 rows hold “Cancel”, so it can't say which one is meant." });
      // A value of the run that was never written in.
      expect(await decided({ kind: "figures", left: cash, is: "equal", right: "{{amount}}" })).toEqual({ status: "unsure", note: "“{{amount}}” isn't a number." });
    });
  });

  it("no-error: nothing raw on the page or in what it said, in the place it names", async () => {
    expect(await decided({ kind: "no-error" })).toEqual({ status: "pass", note: "No raw error on the page." });
    said = ["TypeError: Cannot read properties of undefined (reading 'toFixed')"];
    expect(await decided({ kind: "no-error" })).toEqual({ status: "fail", note: "The page said an exception's name: “TypeError: Cannot read properties of undefined (reading 'toFixed')”." });
    said = [];
    await s.page.setContent(`${PORTFOLIO}<p>Order failed: [object Object]</p>${DIALOG}`);
    expect(await decided({ kind: "no-error" })).toEqual({ status: "fail", note: "The page shows “[object Object]” on the page: “Order failed: [object Object]”." });
    expect(await status({ kind: "no-error", dialog: true })).toBe("pass");
    expect(await status({ kind: "no-error", row: "Apple" })).toBe("pass");
  });

  describe("any and all", () => {
    const on = { kind: "shows", text: "Cash" };
    const off = { kind: "shows", text: "Margin" };
    const unread = { kind: "figures", left: { label: "Buying power" }, is: "equal", right: 0 };

    it("any: one that holds is enough, and it failed only when every one did", async () => {
      expect(await status({ kind: "any", of: [off, on] })).toBe("pass");
      expect(await decided({ kind: "any", of: [off, { kind: "said", text: "Margin" }] })).toEqual({ status: "fail", note: "None of them holds. “Margin” isn't on the page. The page didn't say “Margin”." });
      expect(await status({ kind: "any", of: [off, unread] })).toBe("unsure");
    });

    it("all: the first that fails decides it, else the first that couldn't be told", async () => {
      expect(await status({ kind: "all", of: [on, { kind: "no-error" }] })).toBe("pass");
      expect(await decided({ kind: "all", of: [on, unread, off] })).toEqual({ status: "fail", note: "“Margin” isn't on the page." });
      expect(await status({ kind: "all", of: [on, unread] })).toBe("unsure");
      expect(await status({ kind: "all", of: [on, { kind: "any", of: [off, { kind: "hides", text: "Margin" }] }] })).toBe("pass");
    });

    it("waits as a whole for as long as its slowest part", async () => {
      await s.page.evaluate(() => void setTimeout(() => document.body.append("Order filled"), 500));
      expect(await status({ kind: "all", of: [on, { kind: "shows", text: "Order filled" }], wait: undefined })).toBe("pass");
    });
  });
});
