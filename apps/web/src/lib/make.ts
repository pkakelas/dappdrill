import "server-only";
import { newId } from "@dappdrill/core";
import { db, makes } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { enqueue } from "./jobs";

/** How many tests a make without a goal writes: one for each of the first goals the look finds. */
const TESTS_PER_MAKE = 20;

/**
 * Starts making tests for the app: with a goal, the one test; without, a look over the app and a test
 * for each goal it finds. The app page shows it live, and `userId` hears by email when it ends. Makes
 * on an app go one at a time: one test waits its turn behind a make that is going, and a look over the
 * whole app isn't started while one is (false).
 */
export async function startMake(appId: string, userId: string, goal?: string): Promise<boolean> {
  const [busy] = await db()
    .select({ id: makes.id })
    .from(makes)
    .where(and(eq(makes.appId, appId), inArray(makes.status, ["queued", "running"])));
  if (busy && !goal) return false;
  const id = newId("make");
  await db()
    .insert(makes)
    .values({ id, appId, goal: goal ?? null, count: TESTS_PER_MAKE, requestedBy: userId });
  await enqueue("make.run", { makeId: id });
  return true;
}
