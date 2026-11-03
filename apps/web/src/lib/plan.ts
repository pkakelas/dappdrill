import "server-only";
import { db, runs, scans, type Plan } from "@dappdrill/db";
import { and, count, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { env } from "./env";

export const PLANS: Record<Plan, { name: string; price: string; scansPerMonth: number }> = {
  builder: { name: "Builder", price: "€100 / month", scansPerMonth: 4 },
  free: { name: "Free", price: "Free", scansPerMonth: 1 },
};

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Discovery scans count against the plan; replays never do. */
export async function scansUsedThisMonth(appId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(scans)
    .where(and(eq(scans.appId, appId), gte(scans.createdAt, monthStart())));
  return row?.n ?? 0;
}

export async function scanAllowance(appId: string, plan: Plan) {
  const used = await scansUsedThisMonth(appId);
  const limit = PLANS[plan].scansPerMonth;
  return { used, limit, unlimited: env.dev, left: env.dev ? Infinity : Math.max(0, limit - used) };
}

/** Replays this month across the given apps (runs outside discovery scans). */
export async function replaysThisMonth(appIds: string[]): Promise<number> {
  if (appIds.length === 0) return 0;
  const [row] = await db()
    .select({ n: count() })
    .from(runs)
    .where(and(inArray(runs.appId, appIds), isNotNull(runs.batchId), isNull(runs.scanId), gte(runs.createdAt, monthStart())));
  return row?.n ?? 0;
}
