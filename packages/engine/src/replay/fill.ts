/**
 * Typing into a field, and making sure it took. Controlled inputs drop or reformat what is
 * typed (a price box that keeps the old value, an amount box that adds the thousands separators),
 * so the field is read back and typed into again before the step goes on.
 */
import type { ElementHandle, Locator as PwLocator, Page } from "playwright";

/** How long a field gets to show what was typed before it is typed again. */
const SETTLE_MS = 1_200;

export interface Filled {
  /** The value the field shows now, when it could be read. */
  shows?: string;
  /** Whether it shows what was typed. */
  took: boolean;
}

export async function fillField(page: Page, el: PwLocator, value: string, timeout: number): Promise<Filled> {
  // The element itself from here on. Typing can change the words that found it (a price box marked
  // "Est." is marked otherwise once it holds a price), and a locator would then wait for nothing.
  const field = await el.elementHandle({ timeout });
  if (!field) throw new Error("The field went away before it could be typed into.");
  try {
    await field.fill(value, { timeout });
  } catch {
    await typeLikeAUser(page, field, value, timeout);
  }
  let shows = await settled(field, value);
  if (shows === undefined || sameValue(value, shows)) return { shows, took: true };
  // Typed as a user would, key by key, for an input that ignores a programmatic fill.
  await typeLikeAUser(page, field, value, timeout);
  shows = await settled(field, value);
  return { shows, took: shows === undefined || sameValue(value, shows) };
}

type Field = ElementHandle<SVGElement | HTMLElement>;

async function typeLikeAUser(page: Page, field: Field, value: string, timeout: number): Promise<void> {
  await field.click({ timeout });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value, { delay: 15 });
}

/** The field's value once it shows what was typed, or whatever it shows when the time is up; undefined when it can't be read. */
async function settled(field: Field, value: string): Promise<string | undefined> {
  const until = Date.now() + SETTLE_MS;
  let shows: string | undefined;
  do {
    shows = await field.evaluate((e) => ("value" in e ? String((e as HTMLInputElement).value) : (e.textContent ?? ""))).catch(() => undefined);
    if (shows === undefined || sameValue(value, shows)) return shows;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < until);
  return shows;
}

const NUMBER = /^-?[\d,]*\.?\d*$/;

/**
 * Whether a field shows what was typed: a number however the field formats it ("210" as "$210.00"
 * or "1,000"), anything else as a part of what it shows.
 */
export function sameValue(typed: string, shows: string): boolean {
  const t = typed.trim();
  const s = shows.replace(/\s+/g, " ").trim();
  if (t === s) return true;
  if (NUMBER.test(t) && /\d/.test(t)) {
    const figures = s.match(/-?[\d,]*\.?\d+/g);
    if (!figures) return false;
    const want = Number(t.replace(/,/g, ""));
    return figures.some((f) => Number(f.replace(/,/g, "")) === want);
  }
  return s.toLowerCase().includes(t.toLowerCase());
}
