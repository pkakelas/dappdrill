import { eq } from "drizzle-orm";
import { DrillTarget, type ChainConfig } from "@dappdrill/core";
import { decrypt, apps, testWallets, type Db } from "@dappdrill/db";

export type AppRow = typeof apps.$inferSelect;

export async function loadApp(db: Db, appId: string): Promise<AppRow> {
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) throw new Error(`App ${appId} not found`);
  return app;
}

/**
 * Everything the engine needs for this app: URL, chains, the team's test wallets, live key, inbox.
 *
 * - "analysis": the configured chains (empty = detect), plus chains the app asked the wallet for last time.
 * - "tests": the configured chains pinned at the analysis's fork blocks, or the analysis's chains
 *   when none are configured, so every run starts from the same state.
 */
export async function buildTarget(db: Db, app: AppRow, use: "analysis" | "tests"): Promise<DrillTarget> {
  const [wallets] = await db.select().from(testWallets).where(eq(testWallets.teamId, app.teamId));
  const { settings } = app;
  return DrillTarget.parse({
    url: app.url,
    chains: use === "tests" ? runChains(settings.chains ?? [], app.chains) : (settings.chains ?? []),
    learnedChains: use === "analysis" ? app.chains.filter((c) => c.fromApp).map(({ forkBlock: _, ...c }) => c) : [],
    wallets: settings.wallets?.length ? settings.wallets : undefined,
    accounts: wallets ? { A: decrypt(wallets.accountAKeyEnc), B: decrypt(wallets.accountBKeyEnc) } : undefined,
    liveKey: app.liveKeyEnc ? decrypt(app.liveKeyEnc) : undefined,
    allowMainnetLive: settings.allowMainnetLive ?? false,
    headers: app.accessHeadersEnc ? JSON.parse(decrypt(app.accessHeadersEnc)) : undefined,
    storage: settings.storage,
    responses: settings.responses,
    inbox:
      wallets?.inboxAddress && wallets.inboxPasswordEnc
        ? { address: wallets.inboxAddress, password: decrypt(wallets.inboxPasswordEnc) }
        : undefined,
  });
}

function runChains(configured: ChainConfig[], seen: ChainConfig[]): ChainConfig[] {
  if (configured.length === 0) return seen;
  // Chains the app asked the wallet for during the analysis run in tests too.
  const added = seen.filter((s) => s.fromApp && !configured.some((c) => c.id === s.id));
  return [...configured.map((c) => ({ ...c, forkBlock: c.forkBlock ?? seen.find((s) => s.id === c.id)?.forkBlock })), ...added];
}
