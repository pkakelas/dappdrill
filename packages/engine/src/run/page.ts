/** Reading the page the way a user does. */
import type { Page } from "playwright";
import type { EngineSession } from "../browser/session.js";
import { asRead, loosely } from "./figures.js";

/** What a user can read: the body's text (an open dialog's is part of it) and what the fields hold. */
export async function pageText(page: Page): Promise<string> {
  const text = await page.evaluate(() => {
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((f) => f.value && f.type !== "password" && f.type !== "hidden" && f.checkVisibility());
    return [document.body.innerText, ...fields.map((f) => f.value)].join("\n");
  });
  return asRead(text);
}

/** In one element as written, or across elements and fields the way a person reads them ("Fee" above "$0.04", "1,000" for 1000). */
export async function showsText(page: Page, text: string, waitMs: number): Promise<boolean> {
  const el = page.getByText(text).first();
  const inOne = await (waitMs === 0 ? el.isVisible().catch(() => false) : el.waitFor({ state: "visible", timeout: waitMs }).then(() => true, () => false));
  return inOne || loosely(await pageText(page)).includes(loosely(text));
}

const flat = (text: string) => loosely(text).toLowerCase();

/** Whether the page showed this text at or after a moment, wherever it is now. */
export function saidSince(session: EngineSession, at: number, text: string): boolean {
  return flat(session.said.since(at).join("\n")).includes(flat(text));
}

/**
 * What the page showed at or after a moment and has taken away since: notices, mostly. The latest
 * of each (two that differ only in their figures are one), newest last.
 */
export async function saidAndGone(session: EngineSession, at: number, most = 20): Promise<string[]> {
  const now = flat(await pageText(session.page));
  const latest = new Map<string, string>();
  for (const line of session.said.since(at)) {
    if (now.includes(flat(line))) continue;
    const key = line.replace(/\d[\d.,]*/g, "0");
    latest.delete(key);
    latest.set(key, line);
  }
  return [...latest.values()].slice(-most);
}
