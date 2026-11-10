"use server";

import { BugTriage, bugTestName, newId, openSuggestion, repeatable, testCheckKey, type TestCheck } from "@dappdrill/core";
import { BUG_TEST_NOTE, db, explorations, NEW_TEST_NOTE, nextPosition, queueRuns, tests, touched } from "@dappdrill/db";
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
  const { user } = await requireApp(appId);
  await startPass(appId, user.id);
  refresh(appId);
}

export async function stopExplorationAction(passId: string): Promise<void> {
  const row = await ownPass(passId);
  await db().update(explorations).set({ stopRequested: true }).where(eq(explorations.id, row.id));
  refresh(row.appId);
}

async function ownBug(passId: string, bugId: string) {
  const row = await ownPass(passId);
  const bug = row.state?.bugs.find((b) => b.id === bugId);
  if (!bug) throw new Error("That bug no longer exists.");
  return { row, bug };
}

/**
 * Writes a test for a bug the explorer found, and runs it. It is a draft that fails while the bug is there; its
 * first pass marks the bug fixed (the worker does that), and from then on it is a test like any other.
 */
export async function addBugTestAction(passId: string, bugId: string): Promise<void> {
  const { row, bug } = await ownBug(passId, bugId);
  if (bug.steps.length === 0) throw new Error("This bug has no steps to write a test from.");
  const [linked] = await db().select({ id: tests.id }).from(tests).where(and(eq(tests.appId, row.appId), eq(tests.bugId, bugId)));
  if (linked) return;
  // Named for what the user does: the test the explorer was on when it found the bug, when there was one.
  const name = bugTestName(bug, row.state?.suggested.find((s) => s.bugId === bugId)?.draft.name);
  const [named] = await db().select({ id: tests.id }).from(tests).where(and(eq(tests.appId, row.appId), eq(tests.name, name)));
  const id = named?.id ?? newId("test");
  // A test of that name is the bug's test already, from an earlier exploration: it only needs to run again.
  if (named) await db().update(tests).set({ bugId }).where(eq(tests.id, id));
  else
    await db()
      .insert(tests)
      .values({
        id,
        appId: row.appId,
        bugId,
        name,
        goal: bug.summary,
        expected: bug.expected,
        startPath: row.state?.features.find((f) => f.name === bug.feature)?.startPath ?? "/",
        steps: bug.steps.map((text) => ({ text })),
        position: await nextPosition(db(), row.appId),
        draftNote: BUG_TEST_NOTE,
      });
  const batchId = await queueRuns(db(), row.appId, [id], "manual");
  if (batchId) await enqueue("tests.run", { batchId });
  refresh(row.appId);
}

/** Keeps a check the pass made on a step of one of the app's tests, so every run of the test makes it again. */
export async function keepCheckAction(passId: string, checkId: string, testId: string, stepIndex: number): Promise<{ error?: string }> {
  const row = await ownPass(passId);
  const check = row.state?.checks.find((c) => c.id === checkId);
  if (!check) return { error: "That check no longer exists." };
  if (!repeatable(check.assert)) return { error: "This check copied a number off the page, so it can't be made again as it is." };
  const [t] = await db().select({ id: tests.id, steps: tests.steps, baseId: tests.baseId }).from(tests).where(and(eq(tests.id, testId), eq(tests.appId, row.appId)));
  if (!t || t.baseId) return { error: "Pick one of the app's tests." };
  if (!t.steps[stepIndex]) return { error: "Pick a step of the test." };
  const kept: TestCheck = { name: check.name, assert: check.assert };
  const steps = t.steps.map((s, i) => (i !== stepIndex || s.checks?.some((c) => testCheckKey(c) === testCheckKey(kept)) ? s : { ...s, checks: [...(s.checks ?? []), kept] }));
  await db().update(tests).set({ steps, ...touched() }).where(eq(tests.id, t.id));
  refresh(row.appId);
  return {};
}

/** Dismisses a bug, or brings a dismissed one back. Written as one key, so two people deciding on different bugs don't overwrite each other. */
export async function setBugAction(passId: string, bugId: string, to: "open" | "dismissed"): Promise<void> {
  const { row } = await ownBug(passId, bugId);
  const entry = JSON.stringify({ [bugId]: BugTriage.extract(["open", "dismissed"]).parse(to) });
  await db().update(explorations).set({ triage: sql`${explorations.triage} || ${entry}::jsonb` }).where(eq(explorations.id, row.id));
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
