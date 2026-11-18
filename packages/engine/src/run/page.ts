/** Reading the page the way a user does: all of it, the open dialog, or one row. */
import type { Locator, Page } from "playwright";
import type { EngineSession } from "../browser/session.js";
import { openDialog } from "../replay/locators.js";
import { rowsHolding } from "../replay/rows.js";
import { asRead, loosely } from "./figures.js";

/** What a user can read inside an element: its text (an open dialog's is part of the body's) and what its fields hold. */
async function textOf(el: Locator): Promise<string> {
  const text = await el.evaluate((root) => {
    const fields = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((f) => f.value && f.type !== "password" && f.type !== "hidden" && f.checkVisibility());
    return [(root as HTMLElement).innerText, ...fields.map((f) => f.value)].join("\n");
  });
  return asRead(text);
}

/** What a user can read on the whole page. */
export function pageText(page: Page): Promise<string> {
  return textOf(page.locator("body"));
}

/** Where a check reads: inside the row that holds a text, inside the open dialog or menu, or both. Neither is the whole page. */
export interface Where {
  row?: string;
  dialog?: boolean;
}

/** A place on the page, or why there is none: no dialog is open, no row holds the text. */
export type Place = { root: Locator; rows?: Locator } | { missing: string };

/** Finds where a check reads. `rows` are the rows that hold the text, at least one. */
export async function placeOf(page: Page, where: Where): Promise<Place> {
  const root = where.dialog ? await openDialog(page, true) : page.locator("body");
  if (!root) return { missing: "No dialog or menu is open." };
  if (where.row === undefined) return { root };
  const rows = rowsHolding(root, where.row);
  return (await rows.count()) ? { root, rows } : { missing: `No row${where.dialog ? " in the dialog" : ""} holds “${where.row}”.` };
}

/** The text of a place: one for the page or the dialog, one for each row. */
export async function textsIn(place: Exclude<Place, { missing: string }>): Promise<string[]> {
  if (!place.rows) return [await textOf(place.root)];
  return Promise.all((await place.rows.all()).map(textOf));
}

/** Whether a text holds another, read across elements and fields the way a person reads them ("Fee" above "$0.04", "1,000" for 1000). */
export const reads = (text: string, wanted: string): boolean => loosely(text).includes(loosely(wanted));

/** In one element as written, or across elements and fields the way a person reads them. */
export async function showsText(page: Page, text: string, waitMs: number): Promise<boolean> {
  const el = page.getByText(text).first();
  const inOne = await (waitMs === 0 ? el.isVisible().catch(() => false) : el.waitFor({ state: "visible", timeout: waitMs }).then(() => true, () => false));
  return inOne || reads(await pageText(page), text);
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
