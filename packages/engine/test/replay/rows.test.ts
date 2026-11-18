import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeStep } from "@dappdrill/core";
import { locatorFor, takeSnapshot } from "../../src/agent/snapshot.js";
import { resolveLocator } from "../../src/replay/locators.js";
import { readColumn, rowsHolding } from "../../src/replay/rows.js";
import { createStubSession, type StubSession } from "../agent/fixture/session.js";

vi.setConfig({ testTimeout: 30_000 });

let s: StubSession;

beforeAll(async () => {
  s = await createStubSession();
}, 60_000);

afterAll(async () => {
  await s?.close();
});

const order = (market: string, price: string, status = "Open") =>
  `<tr><td>${market}</td><td>${price}</td><td>0.35</td><td>${status}</td><td><button onclick="document.title = 'cancelled ${price}'">Cancel</button></td></tr>`;
const table = (...rows: string[]) => `<h1>Orders</h1><table><thead><tr><th>Market</th><th>Price</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
const ORDERS = table(order("AAPL", "287.40"), order("AAPL", "291.15"), order("TSLA", "1,204.00", "Filled"));
/** A list with no table and no list items: boxes side by side, one line under another. */
const HOLDINGS = `
  <section>
    <h2>Holdings</h2>
    <div>
      <div style="display:flex;gap:8px"><span>Apple</span><span>$100.00</span><button onclick="document.title = 'closed Apple'">Close</button></div>
      <div style="display:flex;gap:8px"><span>Tesla</span><span>$250.25</span><button onclick="document.title = 'closed Tesla'">Close</button></div>
    </div>
  </section>`;

describe("rows", () => {
  it("finds the row of a table by a text it holds, however the figure is written", async () => {
    await s.page.setContent(ORDERS);
    expect(await rowsHolding(s.page, "287.40").allInnerTexts()).toEqual([expect.stringMatching(/^AAPL\s+287\.40\s+0\.35\s+Open\s+Cancel$/)]);
    expect(await rowsHolding(s.page, "1204").count()).toBe(1);
    expect(await rowsHolding(s.page, "AAPL").count()).toBe(2);
    expect(await rowsHolding(s.page, "300.00").count()).toBe(0);
    // The headings are a row of the table too, and nothing else is.
    expect(await rowsHolding(s.page, "Market").count()).toBe(1);
  });

  it("finds a row built of plain boxes: what stands beside the text, and nothing of the next line", async () => {
    await s.page.setContent(HOLDINGS);
    const tesla = rowsHolding(s.page, "Tesla");
    expect(await tesla.count()).toBe(1);
    expect((await tesla.innerText()).replace(/\s+/g, " ")).toBe("Tesla $250.25 Close");
  });

  it("looks inside the open dialog only when asked to", async () => {
    await s.page.setContent(`${ORDERS}<div role="dialog"><ul><li>Order at 287.40 <button>Cancel</button></li></ul></div>`);
    expect(await rowsHolding(s.page, "287.40").count()).toBe(2);
    expect(await rowsHolding(s.page.getByRole("dialog"), "287.40").count()).toBe(1);
  });
});

describe("a locator with a row", () => {
  it("clicks the control in the row that holds the text, wherever the row stands", async () => {
    const cancel = { role: "button", name: "Cancel", row: "291.15" };
    await s.page.setContent(ORDERS);
    await (await resolveLocator(s.page, cancel, 2_000)).click();
    expect(await s.page.title()).toBe("cancelled 291.15");

    // Next run: the order is the first of four.
    await s.page.setContent(table(order("AAPL", "291.15"), order("NVDA", "140.00"), order("AAPL", "287.40"), order("TSLA", "1,204.00")));
    await (await resolveLocator(s.page, cancel, 2_000)).click();
    expect(await s.page.title()).toBe("cancelled 291.15");
    expect(describeStep({ kind: "click", target: cancel })).toContain("291.15");
  });

  it("works on rows built of plain boxes", async () => {
    await s.page.setContent(HOLDINGS);
    await (await resolveLocator(s.page, { role: "button", name: "Close", row: "Tesla" }, 2_000)).click();
    expect(await s.page.title()).toBe("closed Tesla");
  });

  it("doesn't pick one when no row holds the text, or when no row is named and several match", async () => {
    await s.page.setContent(ORDERS);
    await expect(resolveLocator(s.page, { role: "button", name: "Cancel", row: "300.00" }, 600)).rejects.toThrow(/Could not find .*in the row with "300.00"/);
    await expect(resolveLocator(s.page, { role: "button", name: "Cancel" }, 600)).rejects.toThrow(/several matched/);
  });

  it("is what is recorded for one of several alike controls: by this run's value first, else by a word of its row", async () => {
    await s.page.setContent(ORDERS);
    const snap = await takeSnapshot(s.page);
    const cancels = snap.nodes.filter((n) => n.role === "button" && n.name === "Cancel");
    expect(cancels).toHaveLength(3);
    expect(await locatorFor(s.page, cancels[1]!.ref, ["291.15"])).toEqual({ role: "button", name: "Cancel", row: "291.15" });
    // No value of the run names it: the one word only its row has.
    expect(await locatorFor(s.page, cancels[2]!.ref)).toEqual({ role: "button", name: "Cancel", row: "TSLA" });
    // Nothing tells the two AAPL orders apart but their figures, which nobody said are the run's own.
    expect(await locatorFor(s.page, cancels[1]!.ref)).toEqual({ text: "Cancel", nth: 1 });
    // The only one of its name needs no row.
    await s.page.setContent(table(order("AAPL", "291.15")));
    const one = (await takeSnapshot(s.page)).nodes.find((n) => n.name === "Cancel")!;
    expect(await locatorFor(s.page, one.ref, ["291.15"])).toEqual({ role: "button", name: "Cancel" });
  });
});

describe("readColumn", () => {
  const body = () => s.page.locator("body");

  it("reads a table down a column, or one row's cell", async () => {
    await s.page.setContent(ORDERS);
    expect(await readColumn(body(), "Price")).toEqual({ cells: ["287.40", "291.15", "1,204.00"] });
    expect(await readColumn(body(), "price", "TSLA")).toEqual({ cells: ["1,204.00"] });
    expect(await readColumn(body(), "Price", "AAPL")).toEqual({ cells: ["287.40", "291.15"] });
  });

  it("reads a table with its headings and no rows as empty, and says when there is no such column", async () => {
    await s.page.setContent(table());
    expect(await readColumn(body(), "Price")).toEqual({ cells: [] });
    expect(await readColumn(body(), "Fee")).toEqual({ missing: "No column headed “Fee” on the page." });
    await s.page.setContent(ORDERS);
    expect(await readColumn(body(), "Price", "NVDA")).toEqual({ cells: [] });
  });

  it("reads a table built of plain boxes", async () => {
    const line = (...cells: string[]) => `<div style="display:flex;gap:8px">${cells.map((c) => `<span>${c}</span>`).join("")}</div>`;
    await s.page.setContent(`<div>${line("Asset", "Worth")}${line("Apple", "$100.00")}${line("Tesla", "$250.25")}</div>`);
    expect(await readColumn(body(), "Worth")).toEqual({ cells: ["$100.00", "$250.25"] });
    expect(await readColumn(body(), "Worth", "Tesla")).toEqual({ cells: ["$250.25"] });
  });
});
