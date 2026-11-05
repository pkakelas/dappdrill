import "server-only";
import { analyses, apps, db, encrypt, member, organization, testRuns, testWallets } from "@dappdrill/db";
import { newId } from "@dappdrill/core";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** How many organizations one person may own. */
export const MAX_OWNED = 10;
export const INVITE_DAYS = 7;

export function personalOrgName(user: { name: string; email: string }): string {
  const first = user.name.trim().split(/\s+/)[0] || user.email.split("@")[0];
  return `${first}'s organization`;
}

/** Unique without a lookup. Slugs aren't in URLs yet; Better Auth requires one. */
function slugFor(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${base || "org"}-${randomBytes(3).toString("hex")}`;
}

/**
 * The only place an organization is made: the row, its first owner and its test accounts A and B,
 * in one transaction. Without the wallets a run would fall back to throwaway keys.
 */
export async function provisionOrganization(userId: string, name: string): Promise<string> {
  const id = newId("org");
  const a = generatePrivateKey();
  const b = generatePrivateKey();
  await db().transaction(async (tx) => {
    await tx.insert(organization).values({ id, name, slug: slugFor(name), plan: "builder" });
    await tx.insert(member).values({ id: newId("mem"), organizationId: id, userId, role: "owner" });
    await tx.insert(testWallets).values({
      organizationId: id,
      accountAKeyEnc: encrypt(a),
      accountAAddress: privateKeyToAccount(a).address,
      accountBKeyEnc: encrypt(b),
      accountBAddress: privateKeyToAccount(b).address,
    });
  });
  return id;
}

/** Before an organization goes: ask the worker to stop what it's running for it. The rows go with the organization. */
export async function stopOrganizationJobs(orgId: string): Promise<void> {
  const ids = (await db().select({ id: apps.id }).from(apps).where(eq(apps.organizationId, orgId))).map((a) => a.id);
  if (ids.length === 0) return;
  await db().update(testRuns).set({ stopRequested: true }).where(and(inArray(testRuns.appId, ids), eq(testRuns.status, "running")));
  await db().update(analyses).set({ stopRequested: true }).where(and(inArray(analyses.appId, ids), eq(analyses.status, "running")));
}
