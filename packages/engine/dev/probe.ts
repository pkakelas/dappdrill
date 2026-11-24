/**
 * Opens a URL in the test browser with the current launch environment and the owner's headers,
 * and says whether a bot check is on the page: the live check that a launcher or header change
 * works, without making tests first.
 *
 *   pnpm probe https://app.example.com
 *   DAPPDRILL_CHANNEL=chrome DAPPDRILL_HEADLESS=0 pnpm probe <url> --header "x-dappdrill-token: s3cret"
 *
 * Prints what the browser was launched as, Cloudflare's own trace (its `sliver` is empty on a
 * clean pass), and the provider on the page. Exit 2 when blocked, 0 when clean.
 */
import { parseArgs } from "node:util";
import { cloudflareTrace, detectBotCheck, installAccessHeaders, USER_AGENT } from "../src/browser/access.js";
import { launchBrowser, launchOptions } from "../src/browser/launch.js";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { header: { type: "string", multiple: true } } });
const [url] = positionals;
if (!url) {
  console.error('usage: pnpm probe <url> [--header "Name: value"]…   (proxy $DAPPDRILL_PROXY, build/head $DAPPDRILL_CHANNEL/$DAPPDRILL_HEADLESS)');
  process.exit(2);
}
const headers: Record<string, string> = {};
for (const line of values.header ?? []) {
  const m = /^\s*([A-Za-z0-9-]+)\s*:\s*(.+)$/.exec(line);
  if (!m) {
    console.error(`Bad header "${line}": expected "Name: value"`);
    process.exit(2);
  }
  headers[m[1]!.toLowerCase()] = m[2]!;
}

console.log(`launch: ${JSON.stringify(launchOptions(true))}`);
if (Object.keys(headers).length) console.log(`headers to the app's site: ${Object.keys(headers).join(", ")}`);

const browser = await launchBrowser(true);
try {
  const context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US" });
  await installAccessHeaders(context, url, headers);
  const page = await context.newPage();
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(3_000);
  console.log(`landed: ${res?.status() ?? "no response"} ${page.url()}`);
  const trace = await cloudflareTrace(page);
  console.log(trace ? `trace: ${trace}` : "trace: none (not behind Cloudflare, or its trace is off)");
  const block = await detectBotCheck(page);
  console.log(block ? `BLOCKED by ${block.provider ?? "a challenge"}: ${block.reason}` : "clean: no bot check on the landing page");
  process.exitCode = block ? 2 : 0;
} finally {
  await browser.close().catch(() => {});
}
