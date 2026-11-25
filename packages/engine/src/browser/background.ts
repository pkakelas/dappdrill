/**
 * Keeps a shown test browser out of the way. Some bot checks only pass a browser with a head, and a
 * window opening over your work for every test is no way to work at a desk. Each window is minimized
 * as it opens, and on macOS the app that had the front gets it back. A minimized window still renders,
 * can be filmed and clicked by code, and passed Axelar's Cloudflare check the same as a shown one.
 * A launch position off the screen does not work: Chrome moves the window back onto it.
 *
 * This is for a desk. On a server, give the browser a virtual display (xvfb-run) instead.
 */
import { execFile } from "node:child_process";
import type { BrowserContext, Page } from "playwright";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 3_000 }, (err, stdout) => resolve(err ? "" : stdout.trim())));
}

/** The bundle id of the app at the front, so it can have the front back. macOS only; undefined elsewhere. */
export async function frontApp(): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  const asn = await run("lsappinfo", ["front"]);
  if (!asn) return undefined;
  return /="(.+)"/.exec(await run("lsappinfo", ["info", "-only", "bundleid", asn]))?.[1];
}

/** Minimizes the window a page is in. False when it already was. */
async function minimize(context: BrowserContext, page: Page): Promise<boolean> {
  const cdp = await context.newCDPSession(page);
  try {
    const { windowId, bounds } = await cdp.send("Browser.getWindowForTarget");
    if (bounds.windowState === "minimized") return false;
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    return true;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * Minimizes every window of the context, now and as new ones open, and gives the front back to
 * `front` (from frontApp(), asked before the launch) when the browser took it.
 */
export async function keepInBackground(context: BrowserContext, front: string | undefined): Promise<void> {
  const tuck = async (page: Page): Promise<void> => {
    if (!(await minimize(context, page))) return;
    if (front && (await frontApp()) !== front) await run("open", ["-b", front]);
  };
  context.on("page", (page) => void tuck(page).catch(() => {}));
  await Promise.all(context.pages().map((page) => tuck(page).catch(() => {})));
}
