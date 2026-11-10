/**
 * Letting the page finish what a click started before the next step moves on.
 * An order is placed, a deposit sent, a form saved after the click returns: the
 * button reads "Placing…" and is disabled while the app signs and sends. A step
 * that navigates away then throws that work away, and a snapshot taken then
 * shows the page half way.
 */
import type { Page } from "playwright";
import { BUSY_TEXT } from "./issues.js";

/** The label of a visible button that is disabled and reads busy ("Placing…", "Confirming"), if any. */
export async function busyButton(page: Page): Promise<string | undefined> {
  return page
    .evaluate(({ source, flags }) => {
      const busy = new RegExp(source, flags);
      for (const b of document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"], [aria-busy="true"]')) {
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        const disabled = (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true" || b.getAttribute("aria-busy") === "true";
        const text = (b.getAttribute("aria-label") || b.innerText || (b as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
        if (disabled && text.length < 60 && busy.test(text)) return text;
      }
      return undefined;
    }, { source: BUSY_TEXT.source, flags: BUSY_TEXT.flags })
    .catch(() => undefined);
}

/**
 * Waits while a busy button is on the page, up to `maxMs`. Returns the label it
 * waited on when it did wait, so a caller can say so. `waitingOnUs` says the page
 * is busy because the wallet hasn't answered yet (a signature the next step
 * approves): there is nothing to wait for until it does.
 */
export async function waitQuiet(page: Page, maxMs: number, waitingOnUs?: () => boolean): Promise<string | undefined> {
  const deadline = Date.now() + maxMs;
  let seen: string | undefined;
  for (;;) {
    if (waitingOnUs?.()) return seen;
    const busy = await busyButton(page);
    if (!busy) return seen;
    seen = busy;
    if (Date.now() > deadline) return seen;
    await page.waitForTimeout(250);
  }
}
