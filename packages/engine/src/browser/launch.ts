/**
 * The one place that decides how the test browser is launched, so bot-protection work (a real
 * browser build, a head, a sticky IP, a stealth driver) is set once and applies to every session
 * and to chain detection. Env-driven, so a demo or CI can change it without a code edit:
 *
 *   DAPPDRILL_CHANNEL=chrome|chromium|msedge   a real build: Chrome's TLS/JA4 instead of bundled Chromium
 *   DAPPDRILL_HEADLESS=0                        show the browser (real GPU; needed for a person-like fingerprint)
 *   DAPPDRILL_PROXY=http://user:pass@host:port  a sticky residential IP (warm a profile on it, don't rotate)
 *   DAPPDRILL_STEALTH=1                         launch through Patchright, a patched Playwright that hides the
 *                                               CDP automation tells (Runtime.enable, console) a managed bot
 *                                               check reads. To meet Patchright's "undetected" setup, stealth
 *                                               also runs from a persistent profile and drops the custom
 *                                               user-agent (Patchright says not to set one). It is most
 *                                               effective with real Chrome — set DAPPDRILL_CHANNEL=chrome once
 *                                               Chrome is installed. Console capture goes quiet under stealth
 *                                               (Patchright disables Console.enable).
 *   DAPPDRILL_BACKGROUND=1                      with a shown browser, keep it out of the way: each window is
 *                                               minimized as it opens and the app you were in keeps the front
 *                                               (see background.ts). Headless is not an answer where a bot
 *                                               check wants a head.
 *
 * With none set the behaviour is unchanged: bundled Chromium (via Playwright), the caller's headless choice, no proxy.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium as playwright, type Browser, type BrowserContext, type BrowserContextOptions, type LaunchOptions } from "playwright";
import { chromium as patchright } from "patchright";
import { frontApp, keepInBackground } from "./background.js";

const OFF = new Set(["0", "false", "no", "off"]);

/** On unless the value reads as off. */
function on(value: string | undefined): boolean {
  return !!value && !OFF.has(value.toLowerCase());
}

/** True when runs should go through the Patchright stealth driver. */
export function stealthEnabled(): boolean {
  return on(process.env.DAPPDRILL_STEALTH);
}

/** Launch options with the environment's overrides folded in. */
export function launchOptions(headless: boolean): LaunchOptions {
  return {
    headless: process.env.DAPPDRILL_HEADLESS && OFF.has(process.env.DAPPDRILL_HEADLESS.toLowerCase()) ? false : headless,
    channel: process.env.DAPPDRILL_CHANNEL || undefined,
    ...proxyFromEnv(),
  };
}

export function launchBrowser(headless: boolean): Promise<Browser> {
  return playwright.launch(launchOptions(headless));
}

/** A ready browser context and the one call that tears it (and any profile) down. */
export interface LaunchedContext {
  context: BrowserContext;
  close: () => Promise<void>;
}

/**
 * Opens a context the way the environment asks. Normally that is Playwright launching a browser and
 * a fresh context on it. Under stealth it is Patchright from a throwaway persistent profile with the
 * custom user-agent dropped — the setup Patchright needs to stay undetected. storageState is not a
 * persistent-context option, so under stealth it is applied to the live context instead.
 */
export async function launchContext(headless: boolean, contextOptions: BrowserContextOptions = {}): Promise<LaunchedContext> {
  const options = launchOptions(headless);
  // Asked before the launch, which takes the front.
  const tuck = options.headless === false && on(process.env.DAPPDRILL_BACKGROUND);
  const front = tuck ? await frontApp() : undefined;
  if (!stealthEnabled()) {
    const browser = await playwright.launch(options);
    const context = await browser.newContext(contextOptions);
    if (tuck) await keepInBackground(context, front);
    return { context, close: () => browser.close().catch(() => {}) };
  }

  // Patchright: no custom UA, and a profile dir of its own so the fingerprint is a real browser's.
  const { userAgent: _drop, storageState, ...ctx } = contextOptions;
  const dir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-profile-"));
  const context = (await patchright.launchPersistentContext(dir, { ...options, ...ctx })) as unknown as BrowserContext;
  if (storageState) await applyStorageState(context, storageState);
  if (tuck) await keepInBackground(context, front);
  return {
    context,
    close: async () => {
      await context.close().catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Restores a saved storageState onto a persistent context, which can't take it at launch. */
async function applyStorageState(context: BrowserContext, state: NonNullable<BrowserContextOptions["storageState"]>): Promise<void> {
  const parsed = typeof state === "string" ? JSON.parse(await (await import("node:fs/promises")).readFile(state, "utf8")) : state;
  if (parsed.cookies?.length) await context.addCookies(parsed.cookies).catch(() => {});
  for (const origin of parsed.origins ?? []) {
    const items = origin.localStorage ?? [];
    if (items.length) {
      await context.addInitScript(
        (arg: { url: string; entries: { name: string; value: string }[] }) => {
          if (location.origin === arg.url) for (const { name, value } of arg.entries) localStorage.setItem(name, value);
        },
        { url: origin.origin, entries: items },
      );
    }
  }
}

/** Playwright takes the proxy's host in `server` and its credentials apart. */
function proxyFromEnv(): Pick<LaunchOptions, "proxy"> {
  const raw = process.env.DAPPDRILL_PROXY?.trim();
  if (!raw) return {};
  try {
    const u = new URL(raw);
    return {
      proxy: {
        server: `${u.protocol}//${u.host}`,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      },
    };
  } catch {
    return { proxy: { server: raw } };
  }
}
