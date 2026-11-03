import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
import { elementByRef, formatSnapshot, locatorFor, takeSnapshot } from "../../src/agent/snapshot.js";
import { createStubSession, type StubSession } from "./fixture/session.js";

let s: StubSession;

beforeAll(async () => {
  s = await createStubSession();
}, 60_000);

afterAll(async () => {
  await s?.close();
});

describe("takeSnapshot", () => {
  it("lists interactive elements with stable refs and skips hidden ones", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    const snap = await takeSnapshot(s.page);
    const byName = Object.fromEntries(snap.nodes.map((n) => [n.name, n]));

    expect(byName["Connect wallet"]?.role).toBe("button");
    expect(byName["Vault"]?.role).toBe("link");
    expect(byName["Vault"]?.href).toBe("/vault.html");
    expect(byName["Docs"]?.href).toContain("docs.example.com");
    expect(byName["Tiny Vault"]?.role).toBe("heading");
    // cursor:pointer div-button
    expect(byName["Learn more about vaults"]?.role).toBe("generic");
    // the dialog is hidden
    expect(byName["MetaMask"]).toBeUndefined();
    expect(snap.dialogs).toEqual([]);
    expect(snap.text).toContain("Earn yield on USDC");

    const again = await takeSnapshot(s.page);
    expect(again.nodes.map((n) => n.ref)).toEqual(snap.nodes.map((n) => n.ref));
    expect(formatSnapshot(snap)).toContain(`[${byName["Connect wallet"]!.ref}] button "Connect wallet"`);
  });

  it("reports open dialogs and marks their elements", async () => {
    await s.page.goto(`${s.baseUrl}/`);
    await s.page.getByRole("button", { name: "Connect wallet" }).click();
    const snap = await takeSnapshot(s.page);
    expect(snap.dialogs).toEqual(["Connect a wallet"]);
    const mm = snap.nodes.find((n) => n.name === "MetaMask");
    expect(mm?.inDialog).toBe(true);
    expect(snap.nodes.find((n) => n.name === "Close")?.inDialog).toBe(true);
    expect(formatSnapshot(snap)).toMatch(/Elements in the dialog:\n[\s\S]*?MetaMask[\s\S]*Elements behind the dialog:/);
    expect(snap.text).toContain("Connect a wallet");
  });

  it("reads input values, placeholders and disabled state", async () => {
    await s.page.goto(`${s.baseUrl}/vault.html`);
    await s.page.evaluate(() => sessionStorage.setItem("account", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    await s.page.reload();
    await s.page.getByLabel("Amount").fill("12.5");
    await s.page.evaluate(() => {
      (document.getElementById("withdraw") as HTMLButtonElement).disabled = true;
      document.getElementById("status")!.textContent = "Ready";
    });
    const snap = await takeSnapshot(s.page);
    const amount = snap.nodes.find((n) => n.name === "Amount");
    expect(amount).toMatchObject({ role: "textbox", value: "12.5", placeholder: "0.00" });
    expect(snap.nodes.find((n) => n.name === "Withdraw")?.disabled).toBe(true);
    expect(snap.nodes.find((n) => n.role === "status")).toBeDefined();
  });

  it("finds icon-only custom checkboxes and names them by their label text", async () => {
    // Shaped like Hyperliquid's terms modal: an empty pointer box next to text with links in it.
    await s.page.setContent(`
      <style>.box { width: 16px; height: 16px; border: 1px solid; cursor: pointer } .box div { width: 100%; height: 100% }</style>
      <div style="display: grid; grid-template-columns: 16px 1fr">
        <div class="box"><div></div></div>
        <div style="cursor: pointer">You agree to the <a href="/terms">Terms of Use</a>.</div>
      </div>
    `);
    const snap = await takeSnapshot(s.page);
    const boxes = snap.nodes.filter((n) => n.name.startsWith("unlabeled"));
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.name).toBe('unlabeled, next to "You agree to the Terms of Use."');
    await elementByRef(s.page, boxes[0]!.ref).click();
  });

  it("finds an icon-only close button in a modal without a dialog role", async () => {
    // Shaped like Hyperliquid's Deposit modal: a fixed box, an absolute pointer div holding an aria-hidden svg.
    await s.page.setContent(`
      <style>
        .modal { position: fixed; top: 80px; left: 80px; width: 540px; padding: 24px; background: #fff; z-index: 82 }
        .x { cursor: pointer; position: absolute; top: 24px; right: 24px }
        .x svg { width: 12px; height: 12px }
      </style>
      <main><button>Place order</button></main>
      <div class="modal">
        <div class="x"><svg focusable="false" aria-hidden="true" viewBox="0 0 14 14"><path d="M1 1l12 12M13 1L1 13" stroke="#000"/></svg></div>
        <h2>Deposit USDC</h2>
        <button>Deposit</button>
      </div>
    `);
    const snap = await takeSnapshot(s.page);
    const close = snap.nodes.filter((n) => n.name.startsWith("unlabeled"));
    expect(close.map((n) => n.name)).toEqual(['unlabeled icon in the top-right corner of "Deposit USDC Deposit"']);
    await elementByRef(s.page, close[0]!.ref).click();
  });
});

describe("locatorFor", () => {
  it("prefers role+name, then label, and scopes to dialogs", async () => {
    await s.page.goto(`${s.baseUrl}/vault.html`);
    await s.page.evaluate(() => sessionStorage.setItem("account", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    await s.page.reload();
    const snap = await takeSnapshot(s.page);
    const ref = (name: string) => snap.nodes.find((n) => n.name === name)!.ref;

    expect(await locatorFor(s.page, ref("Deposit"))).toEqual({ role: "button", name: "Deposit" });
    expect(await locatorFor(s.page, ref("Amount"))).toEqual({ role: "textbox", name: "Amount" });

    await s.page.evaluate(() => sessionStorage.clear());
    await s.page.goto(`${s.baseUrl}/`);
    await s.page.getByRole("button", { name: "Connect wallet" }).click();
    const snap2 = await takeSnapshot(s.page);
    const mm = snap2.nodes.find((n) => n.name === "MetaMask")!;
    expect(await locatorFor(s.page, mm.ref)).toEqual({ role: "button", name: "MetaMask", withinDialog: true });
    expect(await elementByRef(s.page, mm.ref).textContent()).toBe("MetaMask");
  });

  it("uses nth for duplicates and testId when present", async () => {
    await s.page.setContent(`
      <button data-testid="go">Go</button>
      <ul><li><span class="x">Item</span></li><li><span class="x">Item</span></li></ul>
      <div id="r-123"><div><span style="cursor:pointer">Pick me</span></div></div>
    `);
    const snap = await takeSnapshot(s.page);
    const go = snap.nodes.find((n) => n.name === "Go")!;
    expect(await locatorFor(s.page, go.ref)).toEqual({ testId: "go" });
    const items = snap.nodes.filter((n) => n.name === "Item");
    expect(items).toHaveLength(0); // plain spans are not interactive
    const pick = snap.nodes.find((n) => n.name === "Pick me")!;
    const loc = await locatorFor(s.page, pick.ref);
    expect(loc.text).toBe("Pick me");
  });

  it("keeps an on-screen side panel when a long table fills the budget", async () => {
    // Morpho's vault page: market tables come first in the DOM, the deposit form is a fixed panel after them.
    const rows = Array.from({ length: 400 }, (_, i) => `<tr><td><button>Market ${i} wstETH / USDC 86% LLTV</button></td></tr>`).join("");
    await s.page.setContent(`
      <table>${rows}</table>
      <aside style="position:fixed;top:80px;right:20px;width:320px">
        <h2>Deposit USDC</h2>
        <input aria-label="Deposit amount" />
        <button>Deposit</button>
      </aside>
    `);
    const snap = await takeSnapshot(s.page, { maxChars: 4_000 });
    const names = snap.nodes.map((n) => n.name);
    expect(names).toContain("Deposit amount");
    expect(names).toContain("Deposit");
    expect(names).toContain("Market 0 wstETH / USDC 86% LLTV");
    expect(names).not.toContain("Market 399 wstETH / USDC 86% LLTV");
    expect(formatSnapshot(snap)).not.toContain("offscreen");
  });
});
