import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
import { describeStep } from "@dappdrill/core";
import { locatorFor, takeSnapshot } from "../../src/agent/snapshot.js";
import { fillField } from "../../src/replay/fill.js";
import { resolveLocator, wording } from "../../src/replay/locators.js";
import { createStubSession, type StubSession } from "../agent/fixture/session.js";

let s: StubSession;

beforeAll(async () => {
  s = await createStubSession();
}, 60_000);

afterAll(async () => {
  await s?.close();
});

/** An order form the way trading apps build it: two fields that only have a placeholder, told apart by the box each sits in. */
const ORDER_FORM = `
  <aside>
    <section>
      <div><div><span>Price</span><span>USD</span></div><div><input placeholder="0.00" /></div></div>
      <div><div><span>Quantity</span></div><div><input placeholder="0.00" /></div></div>
      <div><div><span>Balance</span><span>1,250.50 USDC</span></div><div><input placeholder="0.00" /></div></div>
    </section>
  </aside>`;

describe("locators by the box a field sits in", () => {
  it("records the box around a field that only has a placeholder", async () => {
    await s.page.setContent(ORDER_FORM);
    const snap = await takeSnapshot(s.page);
    const inputs = snap.nodes.filter((n) => n.role === "textbox");
    expect(inputs).toHaveLength(3);
    const loc = await locatorFor(s.page, inputs[1]!.ref);
    // Nothing named is unique, so the last name is kept beside the box instead of a position.
    expect(loc).toEqual({ placeholder: "0.00", near: "Quantity" });
    expect(describeStep({ kind: "fill", target: loc, value: "5" })).toBe('Type "5" into "0.00"');
    expect(describeStep({ kind: "fill", target: { near: "Quantity" }, value: "5" })).toBe('Type "5" into "Quantity"');
  });

  it("finds the right field again when the placeholder is shared and the figure beside it moved", async () => {
    await s.page.setContent(ORDER_FORM);
    const snap = await takeSnapshot(s.page);
    const inputs = snap.nodes.filter((n) => n.role === "textbox");
    const price = await locatorFor(s.page, inputs[0]!.ref);
    const balance = await locatorFor(s.page, inputs[2]!.ref);
    expect(price.near).toBe("PriceUSD");
    expect(balance.near).toBe("Balance1,250.50 USDC");

    // Next run: another balance, the fields in another order.
    await s.page.setContent(ORDER_FORM.replace("1,250.50", "980.1").replace(/(<div><div><span>Price.*?<\/div><\/div>)\s*(<div><div><span>Quantity.*?<\/div><\/div>)/s, "$2$1"));
    await (await resolveLocator(s.page, price, 2_000)).fill("210");
    await (await resolveLocator(s.page, balance, 2_000)).fill("7");
    const values = await s.page.locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values).toEqual(["", "210", "7"]);
  });

  it("leaves a labelled field alone", async () => {
    await s.page.setContent(`<div><label for="a">Amount</label><input id="a" placeholder="0.00" /></div>`);
    const snap = await takeSnapshot(s.page);
    expect(await locatorFor(s.page, snap.nodes[0]!.ref)).toEqual({ role: "textbox", name: "Amount" });
  });

  it("matches the box's words with any figure", () => {
    expect(wording("Balance1,250.50 USDC").test("Balance12.5 USDC")).toBe(true);
    expect(wording("Price").test("Price")).toBe(true);
    expect(wording("Price").test("Price USD")).toBe(false);
  });
});

describe("fillField", () => {
  it("reads the field back and types again when a controlled input dropped the fill", async () => {
    // The field refuses the first programmatic value and takes keystrokes only.
    await s.page.setContent(`<input id="p" value="200" />`);
    await s.page.evaluate(() => {
      const el = document.getElementById("p") as HTMLInputElement;
      let keyed = false;
      el.addEventListener("keydown", () => (keyed = true));
      el.addEventListener("input", () => {
        if (!keyed) el.value = "200";
      });
    });
    const filled = await fillField(s.page, s.page.locator("#p"), "210", 2_000);
    expect(filled).toEqual({ shows: "210", took: true });
  });

  it("says what the field shows when nothing takes", async () => {
    await s.page.setContent(`<input id="p" value="200" />`);
    await s.page.evaluate(() => {
      const el = document.getElementById("p") as HTMLInputElement;
      el.addEventListener("input", () => (el.value = "200"));
    });
    const filled = await fillField(s.page, s.page.locator("#p"), "210", 2_000);
    expect(filled).toEqual({ shows: "200", took: false });
  });

  it("accepts a formatted echo of the number", async () => {
    await s.page.setContent(`<input id="p" />`);
    await s.page.evaluate(() => {
      const el = document.getElementById("p") as HTMLInputElement;
      el.addEventListener("input", () => (el.value = `$${Number(el.value.replace(/[^\d.]/g, "")).toFixed(2)}`));
    });
    const filled = await fillField(s.page, s.page.locator("#p"), "210", 2_000);
    expect(filled).toEqual({ shows: "$210.00", took: true });
  });
});
