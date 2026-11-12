import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { Said } from "../../src/browser/said.js";

const HTML = `<!doctype html><body>
<h1>Orders</h1><p id="price">187.32</p><div id="toasts"></div>
<style>button { display: block }</style>
<button id="place" onclick="
  const t = document.createElement('div'); t.textContent = 'Order submitted'; toasts.append(t);
  setTimeout(() => t.remove(), 400);">Place</button>
<button id="tick" onclick="price.textContent = '187.40'">Tick</button>
<button id="shout" onclick="alert('Not enough   cash')">Shout</button>
<div id="quiet" style="display:none">Trading is paused</div>
<button id="unhide" onclick="quiet.style.display = 'block'">Unhide</button>
</body>`;

let browser: Browser;
let page: Page;
const said = new Said();

beforeAll(async () => {
  browser = await chromium.launch();
  const context = await browser.newContext();
  await said.install(context);
  await context.route("http://app.test/", (route) => route.fulfill({ contentType: "text/html", body: HTML }));
  page = await context.newPage();
  said.watchDialogs(page);
  await page.goto("http://app.test/");
  await page.waitForTimeout(500);
}, 30_000);

afterAll(() => browser?.close());

describe("Said", () => {
  it("keeps what the page shows when it loads", () => {
    expect(said.since(0)).toEqual(expect.arrayContaining(["Orders", "Place"]));
  });

  it("keeps a notice that has gone again", async () => {
    const at = Date.now();
    await page.click("#place");
    await page.waitForTimeout(900);
    expect(await page.getByText("Order submitted").count()).toBe(0);
    expect(said.since(at)).toEqual(["Order submitted"]);
  });

  it("leaves out figures on their own", async () => {
    const at = Date.now();
    await page.click("#tick");
    await page.waitForTimeout(500);
    expect(said.since(at)).toEqual([]);
  });

  it("keeps what a browser dialog said", async () => {
    const at = Date.now();
    await page.click("#shout");
    await page.waitForTimeout(300);
    expect(said.since(at)).toEqual(["Not enough cash"]);
  });

  it("sees text that a style change brings out", async () => {
    const at = Date.now();
    await page.click("#unhide");
    await page.waitForTimeout(500);
    expect(said.since(at)).toEqual(["Trading is paused"]);
  });

  it("goes on after the page is loaded again", async () => {
    await page.reload();
    const at = Date.now();
    await page.click("#place");
    await page.waitForTimeout(500);
    expect(said.since(at)).toContain("Order submitted");
  });
});
