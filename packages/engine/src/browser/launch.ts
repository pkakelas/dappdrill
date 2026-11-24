/**
 * The one place that decides how the test browser is launched, so bot-protection work (a real
 * browser build, a head, a sticky IP) is set once and applies to every session and to chain
 * detection. Env-driven, so a demo or CI can change it without a code edit:
 *
 *   DAPPDRILL_CHANNEL=chrome|chromium|msedge   a real build: Chrome's TLS/JA4 instead of bundled Chromium
 *   DAPPDRILL_HEADLESS=0                        show the browser (real GPU; needed for a person-like fingerprint)
 *   DAPPDRILL_PROXY=http://user:pass@host:port  a sticky residential IP (warm a profile on it, don't rotate)
 *
 * With none set the behaviour is unchanged: bundled Chromium, the caller's headless choice, no proxy.
 */
import { chromium, type Browser, type LaunchOptions } from "playwright";

const OFF = new Set(["0", "false", "no", "off"]);

/** Launch options with the environment's overrides folded in. */
export function launchOptions(headless: boolean): LaunchOptions {
  return {
    headless: process.env.DAPPDRILL_HEADLESS && OFF.has(process.env.DAPPDRILL_HEADLESS.toLowerCase()) ? false : headless,
    channel: process.env.DAPPDRILL_CHANNEL || undefined,
    ...proxyFromEnv(),
  };
}

export function launchBrowser(headless: boolean): Promise<Browser> {
  return chromium.launch(launchOptions(headless));
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
