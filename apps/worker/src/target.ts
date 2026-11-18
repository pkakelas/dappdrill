import { eq } from "drizzle-orm";
import { DrillTarget, type Suite } from "@dappdrill/core";
import { accountOf, decrypt, apps, suiteOf, testWallets, type Db, type TestRow } from "@dappdrill/db";

export type AppRow = typeof apps.$inferSelect;

export async function loadApp(db: Db, appId: string): Promise<AppRow> {
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) throw new Error(`App ${appId} not found`);
  return app;
}

/**
 * Everything the engine needs for this app: its URL and chains, the account choice, the key that holds
 * funds and what it sends each new account, the organization's test wallets and inbox.
 *
 * - "look": the configured chains (empty = detect), plus chains the app asked the wallet for last time.
 * - "tests": the configured chains with those, or the last look's chains when none are configured.
 */
export async function buildTarget(db: Db, app: AppRow, use: "look" | "tests"): Promise<DrillTarget> {
  const [wallets] = await db.select().from(testWallets).where(eq(testWallets.organizationId, app.organizationId));
  const { settings } = app;
  const configured = settings.chains ?? [];
  const asked = app.chains.filter((c) => c.fromApp);
  return DrillTarget.parse({
    url: app.url,
    chains: use === "look" ? configured : configured.length ? [...configured, ...asked.filter((a) => !configured.some((c) => c.id === a.id))] : app.chains,
    learnedChains: use === "look" ? asked : [],
    wallets: settings.wallets?.length ? settings.wallets : undefined,
    account: accountOf(app),
    accounts: wallets ? { A: decrypt(wallets.accountAKeyEnc), B: decrypt(wallets.accountBKeyEnc) } : undefined,
    fundedKey: app.liveKeyEnc ? decrypt(app.liveKeyEnc) : undefined,
    fund: settings.fund,
    funding: settings.funding || undefined,
    headers: app.accessHeadersEnc ? JSON.parse(decrypt(app.accessHeadersEnc)) : undefined,
    storage: settings.storage,
    responses: settings.responses,
    inbox:
      wallets?.inboxAddress && wallets.inboxPasswordEnc
        ? { address: wallets.inboxAddress, password: decrypt(wallets.inboxPasswordEnc) }
        : undefined,
  });
}

/**
 * The app's suite with these tests, as the engine takes it. What the owner said about getting test
 * funds is kept with the app's chains, not with its notes, so it is added here as a note for whoever
 * does the actions.
 */
export function appSuite(app: AppRow, tests: TestRow[]): Suite {
  const suite = suiteOf(app, tests);
  const { funding } = app.settings;
  return funding ? { ...suite, notes: [...suite.notes, { text: `How to get test funds: ${funding}`, from: "owner" }] } : suite;
}
