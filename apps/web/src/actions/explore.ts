"use server";

import { BugTriage, newId, openSuggestion, type ExploreBug } from "@dappdrill/core";
import { db, explorations, NEW_TEST_NOTE, nextPosition, queueRuns, tests } from "@dappdrill/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { enqueue } from "@/lib/jobs";
import { startPass } from "@/lib/pass";
import { requireApp } from "@/lib/session";

const refresh = (appId: string) => revalidatePath(`/apps/${appId}`, "layout");

async function ownPass(passId: string) {
  const [row] = await db().select().from(explorations).where(eq(explorations.id, passId));
  if (!row) throw new Error("That exploration no longer exists.");
  await requireApp(row.appId);
  return row;
}

/** Looks around the app again. Tests stay as they are; it adds what it hasn't seen. */
export async function exploreAction(appId: string): Promise<void> {
  await requireApp(appId);
  await startPass(appId);
  refresh(appId);
}

export async function stopExplorationAction(passId: string): Promise<void> {
  const row = await ownPass(passId);
  await db().update(explorations).set({ stopRequested: true }).where(eq(explorations.id, row.id));
  refresh(row.appId);
}

/** A bug somebody accepted becomes a draft test: it fails until the bug is fixed, then it is a test like any other. */
async function testForBug(appId: string, bug: ExploreBug, startPath: string): Promise<void> {
  const [taken] = await db().select({ id: tests.id }).from(tests).where(and(eq(tests.appId, appId), eq(tests.name, bug.name)));
  if (taken) return;
  await db()
    .insert(tests)
    .values({
      id: newId("test"),
      appId,
      name: bug.name,
      goal: bug.summary,
      expected: bug.expected,
      startPath,
      steps: bug.steps.map((text) => ({ text })),
      position: await nextPosition(db(), appId),
      draftNote: "Written from a bug. It passes once the bug is fixed.",
    });
}

/** Written as one key, so two people triaging different bugs don't overwrite each other. */
export async function triageBugAction(passId: string, bugId: string, value: string): Promise<void> {
  const row = await ownPass(passId);
  const bug = row.state?.bugs.find((b) => b.id === bugId);
  if (!bug) throw new Error("That bug no longer exists.");
  const triage = BugTriage.parse(value);
  const entry = JSON.stringify({ [bugId]: triage });
  await db().update(explorations).set({ triage: sql`${explorations.triage} || ${entry}::jsonb` }).where(eq(explorations.id, row.id));
  if (triage === "accepted" && bug.steps.length > 0) await testForBug(row.appId, bug, row.state?.features.find((f) => f.name === bug.feature)?.startPath ?? "/");
  refresh(row.appId);
}

/** Saves suggested tests as drafts and runs them. With no ids, every one still on offer. */
export async function addSuggestedAction(passId: string, ids?: string[]): Promise<void> {
  const row = await ownPass(passId);
  const taken = new Set((await db().select({ name: tests.name }).from(tests).where(eq(tests.appId, row.appId))).map((t) => t.name));
  const wanted = (row.state?.suggested ?? []).filter((s) => openSuggestion(s) && !taken.has(s.draft.name) && (!ids || ids.includes(s.id)));
  const added: string[] = [];
  for (const s of wanted) {
    const id = newId("test");
    const { name, goal, expected, startPath, steps } = s.draft;
    await db()
      .insert(tests)
      .values({ id, appId: row.appId, name, goal, expected, startPath, steps: steps.map((text) => ({ text })), position: await nextPosition(db(), row.appId), draftNote: NEW_TEST_NOTE });
    added.push(id);
  }
  const batchId = added.length ? await queueRuns(db(), row.appId, added, "manual") : undefined;
  if (batchId) await enqueue("tests.run", { batchId });
  refresh(row.appId);
}
