import { eq } from "drizzle-orm";
import { DrillTarget, setupWithRecordings, type ChainConfig, type LineResult } from "@dappdrill/core";
import { decrypt, apps, testWallets, updateApp, type Db } from "@dappdrill/db";

export { updateApp };

export type AppRow = typeof apps.$inferSelect;

export async function loadApp(db: Db, appId: string): Promise<AppRow> {
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) throw new Error(`App ${appId} not found`);
  return app;
}

/**
 * Saves the browser actions a model took for the setup's code actions, so the next run replays them.
 * Nothing is saved when the setup has been changed to another number of lines meanwhile.
 */
export async function keepSetup(db: Db, appId: string, lines: LineResult[] | undefined): Promise<void> {
  if (!lines?.some((s) => s.recorded?.length)) return;
  await updateApp(db, appId, ({ suite }) => (suite.setup && suite.setup.steps.length === lines.length ? { suite: { ...suite, setup: setupWithRecordings(suite.setup, lines) } } : undefined));
}

/** Whether the app's tests run on a chain that can't be forked: one live account, shared by every run. */
export function liveChains(app: AppRow): boolean {
  return [...(app.settings.chains ?? []), ...app.chains].some((c) => c.mode === "live");
}

/**
 * Everything the engine needs for this app: URL, chains, the organization's test wallets, live key, inbox.
 *
 * - "look": the configured chains (empty = detect), plus chains the app asked the wallet for last time.
 * - "tests": the configured chains pinned at the blocks the last look copied them at, or that look's
 *   chains when none are configured, so every run starts from the same state.
 */
export async function buildTarget(db: Db, app: AppRow, use: "look" | "tests"): Promise<DrillTarget> {
  const [wallets] = await db.select().from(testWallets).where(eq(testWallets.organizationId, app.organizationId));
  const { settings } = app;
  return DrillTarget.parse({
    url: app.url,
    chains: use === "tests" ? runChains(settings.chains ?? [], app.chains) : (settings.chains ?? []),
    learnedChains: use === "look" ? app.chains.filter((c) => c.fromApp).map(({ forkBlock: _, ...c }) => c) : [],
    wallets: settings.wallets?.length ? settings.wallets : undefined,
    accounts: wallets ? { A: decrypt(wallets.accountAKeyEnc), B: decrypt(wallets.accountBKeyEnc) } : undefined,
    liveKey: app.liveKeyEnc ? decrypt(app.liveKeyEnc) : undefined,
    funding: settings.funding || undefined,
    allowMainnetLive: settings.allowMainnetLive ?? false,
    headers: app.accessHeadersEnc ? JSON.parse(decrypt(app.accessHeadersEnc)) : undefined,
    tokens: settings.tokens,
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
  // Chains the app asked the wallet for during the look run in tests too.
  const added = seen.filter((s) => s.fromApp && !configured.some((c) => c.id === s.id));
  return [
    ...configured.map((c) => {
      const s = seen.find((x) => x.id === c.id);
      return { ...c, forkBlock: c.forkBlock ?? s?.forkBlock, ...(s?.relays ? { relays: true } : {}) };
    }),
    ...added,
  ];
}

/**
 * What the owner said about getting test funds, as a note for whoever does the actions. It is kept
 * with the app's chains, not with its notes, so it is added to the suite here.
 */
export function ownerNotes(app: AppRow): Pick<AppRow["suite"], "notes"> {
  const { funding } = app.settings;
  return { notes: funding ? [...app.suite.notes, { text: `How to get test funds: ${funding}`, from: "owner" as const }] : app.suite.notes };
}
