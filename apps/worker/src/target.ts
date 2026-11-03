import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { DrillTarget, type ChainConfig, type SigningReview } from "@dappdrill/core";
import { decrypt, apps, flows, scans, signingReviews, testWallets, type AppSettings, type Db } from "@dappdrill/db";

export type AppRow = typeof apps.$inferSelect;

export async function loadApp(db: Db, appId: string): Promise<AppRow> {
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) throw new Error(`App ${appId} not found`);
  return app;
}

/** Everything the engine needs for this app: URL, chains, the team's test wallets, live key, inbox. */
export async function buildTarget(db: Db, app: AppRow, settings: AppSettings, chains: ChainConfig[] = settings.chains ?? []): Promise<DrillTarget> {
  const [wallets] = await db.select().from(testWallets).where(eq(testWallets.teamId, app.teamId));
  return DrillTarget.parse({
    url: app.url,
    chains,
    wallets: settings.wallets?.length ? settings.wallets : undefined,
    edgeCases: settings.edgeCases?.length ? settings.edgeCases : undefined,
    accounts: wallets ? { A: decrypt(wallets.accountAKeyEnc), B: decrypt(wallets.accountBKeyEnc) } : undefined,
    liveKey: app.liveKeyEnc ? decrypt(app.liveKeyEnc) : undefined,
    allowMainnetLive: settings.allowMainnetLive ?? false,
    inbox:
      wallets?.inboxAddress && wallets.inboxPasswordEnc
        ? { address: wallets.inboxAddress, password: decrypt(wallets.inboxPasswordEnc) }
        : undefined,
  });
}

/** Accepted signing reviews ("Accept as new baseline"), keyed by fingerprint. */
export async function loadBaselines(db: Db, appId: string): Promise<Record<string, SigningReview>> {
  const rows = await db
    .select({ fingerprint: signingReviews.fingerprint, data: signingReviews.data })
    .from(signingReviews)
    .where(and(eq(signingReviews.appId, appId), eq(signingReviews.isBaseline, true)));
  return Object.fromEntries(rows.map((r) => [r.fingerprint, r.data]));
}

/** The app's flows that earlier scans discovered, so a rescan updates them rather than adding copies. */
export async function loadKnownFlows(db: Db, appId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: flows.id, name: flows.name })
    .from(flows)
    .where(and(eq(flows.appId, appId), eq(flows.archived, false), sql`${flows.definition}->>'origin' = 'discovered'`))
    .orderBy(flows.createdAt);
}

/**
 * Chains for a replay: the app's configured chains, with fork blocks pinned by the
 * latest finished scan; or that scan's detected chains when the app has none configured.
 */
export async function replayChains(db: Db, app: AppRow): Promise<ChainConfig[]> {
  const [latest] = await db
    .select({ chains: scans.chains })
    .from(scans)
    .where(and(eq(scans.appId, app.id), eq(scans.status, "done"), ne(sql`jsonb_array_length(${scans.chains})`, 0), isNotNull(scans.finishedAt)))
    .orderBy(desc(scans.finishedAt))
    .limit(1);
  const scanned = latest?.chains ?? [];
  const configured = app.settings.chains ?? [];
  if (configured.length === 0) return scanned;
  return configured.map((c) => ({ ...c, forkBlock: c.forkBlock ?? scanned.find((s) => s.id === c.id)?.forkBlock }));
}
