import "server-only";
import { newId } from "@dappdrill/core";
import { db, explorations } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { enqueue } from "./jobs";

/** The most minutes a pass explores for. It ends sooner when nothing new turns up. */
const PASS_MINUTES = 15;

/** Starts a pass over the app unless one is already going; the app page shows it live, and `userId` hears by email when it ends. */
export async function startPass(appId: string, userId: string): Promise<void> {
  const [busy] = await db()
    .select({ id: explorations.id })
    .from(explorations)
    .where(and(eq(explorations.appId, appId), inArray(explorations.status, ["queued", "running"])));
  if (busy) return;
  const id = newId("exp");
  await db().insert(explorations).values({ id, appId, budgetMinutes: PASS_MINUTES, requestedBy: userId });
  await enqueue("exploration.run", { explorationId: id });
}
