/**
 * A DrillSession for agent tests: a plain Playwright page on the fixture site
 * with the FakeWallet injected. No chains, no artifacts beyond screenshots.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { DrillTarget, type ConsoleEntry, type DrillEvent, type RpcLogEntry } from "@dappdrill/core";
import type { ChainController, DrillSession } from "../../../src/types.js";
import { FakeWallet } from "./fake-wallet.js";
import { startFixtureSite } from "./server.js";

export interface StubSession extends DrillSession {
  readonly wallet: FakeWallet;
  readonly events: DrillEvent[];
  readonly baseUrl: string;
}

export async function createStubSession(opts: { url?: string; headless?: boolean } = {}): Promise<StubSession> {
  const site = opts.url ? undefined : await startFixtureSite();
  const baseUrl = opts.url ?? site!.url;
  const browser: Browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const wallet = new FakeWallet();
  let lastLabel: string | undefined;
  const page = await context.newPage();
  await wallet.attach(context, { lastClickedLabel: () => lastLabel, pageUrl: () => page.url() });
  await context.exposeBinding("__ddTestClicked", (_s, label: string) => { lastLabel = label; });
  await context.addInitScript(() => {
    document.addEventListener("pointerdown", (e) => {
      const el = (e.target as Element | null)?.closest("button,a,[role=button],input,label") ?? (e.target as Element | null);
      const label = el?.getAttribute("aria-label") ?? el?.textContent?.trim().slice(0, 60);
      if (label) (window as unknown as { __ddTestClicked: (l: string) => void }).__ddTestClicked(label);
    }, true);
  });
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-agent-test-"));
  await mkdir(path.join(artifactsDir, "screenshots"));
  const consoleLog: ConsoleEntry[] = [];
  const events: DrillEvent[] = [];
  page.on("console", (m) => {
    const level = (["log", "info", "warn", "error"] as const).find((l) => l === m.type()) ?? "log";
    consoleLog.push({ level, text: m.text(), at: new Date().toISOString() });
  });
  page.on("pageerror", (e) => consoleLog.push({ level: "pageerror", text: e.message, at: new Date().toISOString() }));
  const target = DrillTarget.parse({ url: baseUrl, chains: [], wallets: ["metamask"], edgeCases: [] });
  let shots = 0;

  return {
    page,
    context,
    wallet,
    chains: { has: () => false, missing: () => [], configs: () => [] } as unknown as ChainController,
    target,
    artifactsDir,
    console: consoleLog,
    rpc: [] as RpcLogEntry[],
    events,
    baseUrl,
    emit: (e) => { events.push(e); },
    async screenshot(name) {
      const rel = `screenshots/${String(++shots).padStart(3, "0")}-${name}.png`;
      await writeFile(path.join(artifactsDir, rel), await page.screenshot({ type: "png" }));
      return rel;
    },
    lastClickedLabel: () => lastLabel,
    async close() {
      await browser.close();
      await site?.close();
      return {};
    },
  };
}
