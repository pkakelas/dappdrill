/**
 * How DappDrill gets past bot protection: it says who it is, and sends the
 * owner's allowlist header to the app's own site. It never solves or evades a
 * challenge; when one shows up we name it so the owner knows what to configure.
 */
import type { BrowserContext, Frame, Page } from "playwright";
import type { Blocked } from "@dappdrill/core";

/** Chrome's user agent plus our own token, so owners can recognise and allow us. */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 DappDrill/1.0 (+https://dappdrill.com/bot)";

/** Second-level labels under which registrable domains sit one level deeper (example.co.uk). */
const SHARED_SLDS = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** The registrable domain of a hostname, close enough for scoping headers ("app.aave.com" → "aave.com"). */
export function siteOf(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return host;
  const labels = host.split(".");
  const n = labels.at(-1)!.length === 2 && SHARED_SLDS.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-n).join(".");
}

/** True when `url` is on the same site as the app, so it may carry the owner's headers. */
export function onAppSite(url: string, appUrl: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const site = siteOf(new URL(appUrl).hostname);
    return host === site || host.endsWith(`.${site}`);
  } catch {
    return false;
  }
}

/** Adds the target's headers to requests for the app's own site only. */
export async function installAccessHeaders(context: BrowserContext, appUrl: string, headers: Record<string, string>): Promise<void> {
  if (Object.keys(headers).length === 0) return;
  await context.route(
    (url) => onAppSite(url.href, appUrl),
    (route) => route.fallback({ headers: { ...route.request().headers(), ...headers } }),
  );
}

const PROVIDER_FRAMES: [RegExp, string][] = [
  [/challenges\.cloudflare\.com/i, "Cloudflare"],
  [/hcaptcha\.com/i, "hCaptcha"],
  [/google\.com\/recaptcha|recaptcha\.net/i, "reCAPTCHA"],
  [/captcha-delivery\.com/i, "DataDome"],
  [/perimeterx|px-cdn|px-captcha/i, "HUMAN (PerimeterX)"],
  [/arkoselabs|funcaptcha/i, "Arkose Labs"],
];
const PROVIDER_TEXT: [RegExp, string][] = [
  [/vercel security checkpoint/i, "Vercel"],
  [/cloudflare|just a moment|attention required|checking your browser|cf-ray/i, "Cloudflare"],
  [/datadome/i, "DataDome"],
  [/akamai|reference #\d+\.[0-9a-f]+/i, "Akamai"],
];
const BLOCKED_TEXT = /captcha|turnstile|just a moment|verify you are human|checking your browser|attention required|access denied|security checkpoint/i;

/**
 * Invisible widgets (Privy's hCaptcha, reCAPTCHA v3, invisible Turnstile) load a
 * provider frame that nobody is asked to solve, so a frame only counts when a
 * person would see something to click.
 */
async function shownToUser(page: Page, frame: Frame): Promise<boolean> {
  if (frame === page.mainFrame()) return true;
  if (/invisible/i.test(frame.url())) return false;
  const el = await frame.frameElement().catch(() => undefined);
  if (!el || !(await el.isVisible().catch(() => false))) return false;
  const box = await el.boundingBox().catch(() => null);
  return !!box && box.width >= 40 && box.height >= 40 && box.x + box.width > 0 && box.y + box.height > 0;
}

/** A bot check on the page, with its provider when we can tell; undefined when the page looks normal. */
export async function detectBotCheck(page: Page): Promise<Blocked | undefined> {
  const url = page.url();
  for (const frame of page.frames()) {
    const hit = PROVIDER_FRAMES.find(([re]) => re.test(frame.url()));
    const generic = !hit && /captcha|turnstile/i.test(frame.url());
    if ((!hit && !generic) || !(await shownToUser(page, frame))) continue;
    return hit ? { provider: hit[1], reason: `A ${hit[1]} challenge is on the page`, url } : { reason: "A CAPTCHA frame is on the page", url };
  }
  const title = await page.title().catch(() => "");
  const text = await page.evaluate(() => document.body?.innerText.slice(0, 1500) ?? "").catch(() => "");
  if (!BLOCKED_TEXT.test(title) && !BLOCKED_TEXT.test(text.slice(0, 500))) return undefined;
  const provider = PROVIDER_TEXT.find(([re]) => re.test(`${title}\n${text}`))?.[1];
  return { provider, reason: title && BLOCKED_TEXT.test(title) ? `The page is a bot check ("${title}")` : "The page text looks like a bot check", url };
}
