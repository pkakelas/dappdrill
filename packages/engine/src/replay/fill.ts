/**
 * Typing into a field, and making sure it took. Controlled inputs drop or reformat what is
 * typed (a price box that keeps the old value, an amount box that adds the thousands separators),
 * so the field is read back and typed into again before the step goes on.
 */
import type { Locator as PwLocator, Page } from "playwright";

/** How long a field gets to show what was typed before it is typed again. */
const SETTLE_MS = 1_200;

export interface Filled {
  /** The value the field shows now, when it could be read. */
  shows?: string;
  /** Whether it shows what was typed. */
  took: boolean;
}

export async function fillField(page: Page, el: PwLocator, value: string, timeout: number): Promise<Filled> {
  try {
    await el.fill(value, { timeout });
  } catch {
    await typeLikeAUser(page, el, value, timeout);
  }
  let shows = await settled(el, value);
  if (shows === undefined || sameValue(value, shows)) return { shows, took: true };
  // Typed as a user would, key by key, for an input that ignores a programmatic fill.
  await typeLikeAUser(page, el, value, timeout);
  shows = await settled(el, value);
  return { shows, took: shows === undefined || sameValue(value, shows) };
}

async function typeLikeAUser(page: Page, el: PwLocator, value: string, timeout: number): Promise<void> {
  await el.click({ timeout });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await el.pressSequentially(value, { timeout, delay: 15 });
}

/** The field's value once it shows what was typed, or whatever it shows when the time is up; undefined when it can't be read. */
async function settled(el: PwLocator, value: string): Promise<string | undefined> {
  const until = Date.now() + SETTLE_MS;
  let shows: string | undefined;
  do {
    shows = await el.evaluate((e) => ("value" in e ? String((e as HTMLInputElement).value) : (e.textContent ?? ""))).catch(() => undefined);
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
