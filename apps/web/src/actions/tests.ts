"use server";

import { EdgeCaseId, OFFERED_CONDITIONS, keepActions, newId, walletUse } from "@dappdrill/core";
import { addConditions, db, nextPosition, notWritten, queueRuns, sentenceName, testRuns, tests, touched, type Trigger } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enqueue } from "@/lib/jobs";
import { requireApp } from "@/lib/session";

async function ownTest(testId: string) {
  const [t] = await db().select().from(tests).where(eq(tests.id, testId));
  if (!t) throw new Error("That test no longer exists.");
  await requireApp(t.appId);
  return t;
}

async function run(appId: string, testIds: string[], trigger: Trigger = "manual") {
  // A test already queued or running isn't queued twice.
  const busy = testIds.length
    ? await db()
        .select({ id: testRuns.testId })
        .from(testRuns)
        .where(and(inArray(testRuns.testId, testIds), inArray(testRuns.status, ["queued", "running"])))
    : [];
  const ids = testIds.filter((id) => !busy.some((b) => b.id === id));
  const batchId = await queueRuns(db(), appId, ids, trigger);
  if (batchId) await enqueue("tests.run", { batchId });
}

/** Drafts are written by the worker, then run. */
async function draft(row: typeof tests.$inferInsert & { drafting: string }) {
  await db().insert(tests).values(row);
  await enqueue("test-draft.run", { testId: row.id });
}

const refresh = (appId: string) => revalidatePath(`/apps/${appId}`, "layout");

// ---------------------------------------------------------------- running

export async function runTestsAction(appId: string, testIds: string[]): Promise<void> {
  await requireApp(appId);
  const own = await db().select({ id: tests.id }).from(tests).where(and(eq(tests.appId, appId), inArray(tests.id, testIds)));
  await run(appId, own.map((t) => t.id));
  refresh(appId);
}

export async function runAllAction(appId: string): Promise<void> {
  await requireApp(appId);
  const ids = await db().select({ id: tests.id }).from(tests).where(eq(tests.appId, appId));
  await run(appId, ids.map((t) => t.id));
  refresh(appId);
}

/** Stops queued and running runs of the given tests (all of the app's when none are given). */
export async function stopRunsAction(appId: string, testIds?: string[]): Promise<void> {
  await requireApp(appId);
  const scope = and(eq(testRuns.appId, appId), testIds ? inArray(testRuns.testId, testIds) : undefined);
  await db()
    .update(testRuns)
    .set({ status: "stopped", finishedAt: new Date() })
    .where(and(scope, eq(testRuns.status, "queued")));
  await db()
    .update(testRuns)
    .set({ stopRequested: true })
    .where(and(scope, eq(testRuns.status, "running")));
  refresh(appId);
}

// ---------------------------------------------------------------- writing

const Sentence = z.string().trim().min(3, "Say what the test should do.").max(1000);

/** A test from one sentence. Returns the new test's id. */
export async function addTestAction(appId: string, request: string): Promise<{ error?: string; testId?: string }> {
  await requireApp(appId);
  const text = Sentence.safeParse(request);
  if (!text.success) return { error: text.error.issues[0]?.message };
  const id = newId("test");
  await draft({
    id,
    appId,
    name: sentenceName(text.data),
    goal: text.data,
    expected: "",
    steps: [],
    drafting: text.data,
    position: await nextPosition(db(), appId),
  });
  refresh(appId);
  return { testId: id };
}

/** Writes the steps of a test that only has a name and a goal; it runs when written. */
export async function writeTestAction(testId: string): Promise<void> {
  const t = await ownTest(testId);
  if (!notWritten(t)) return;
  await db().update(tests).set({ drafting: t.goal || t.name, ...touched() }).where(eq(tests.id, testId));
  await enqueue("test-draft.run", { testId });
  refresh(t.appId);
}

/** A copy of a test with one change, written by the worker. Opens the copy. */
export async function duplicateTestAction(testId: string, change: string): Promise<{ error?: string }> {
  const base = await ownTest(testId);
  if (base.baseId) return { error: "Duplicate the test itself; a condition row follows its test." };
  const text = Sentence.safeParse(change);
  if (!text.success) return { error: "Say what the copy should do differently." };
  const id = newId("test");
  await draft({
    id,
    appId: base.appId,
    name: base.name,
    goal: base.goal,
    expected: base.expected,
    startPath: base.startPath,
    steps: base.steps,
    forkedFrom: base.id,
    drafting: text.data,
    position: base.position,
  });
  refresh(base.appId);
  redirect(`/apps/${base.appId}/tests/${id}`);
}

const Edit = z.object({
  name: z.string().trim().min(1, "Name the test.").max(80),
  goal: z.string().trim().min(1, "Say what the test does.").max(1000),
  expected: z.string().trim().min(1, "Say what should be on the page when it works.").max(1000),
  steps: z.array(z.string().trim().max(200)).transform((s) => s.filter(Boolean)).pipe(z.array(z.string()).max(20, "Keep it under 20 steps.")),
});

export async function updateTestAction(testId: string, input: z.input<typeof Edit>): Promise<{ error?: string }> {
  const t = await ownTest(testId);
  // A condition row has nothing of its own: name and expected come from the condition, goal and steps from its test.
  if (t.baseId || t.condition) return { error: "A condition can't be edited. Edit the test it runs on." };
  const e = Edit.safeParse(input);
  if (!e.success) return { error: e.error.issues[0]?.message };
  await db()
    .update(tests)
    .set({
      name: e.data.name,
      goal: e.data.goal,
      expected: e.data.expected,
      steps: keepActions(e.data.steps, t.steps),
      ...(e.data.expected !== t.expected ? { proof: null } : {}),
      ...touched(),
    })
    .where(eq(tests.id, testId));
  refresh(t.appId);
  return {};
}

/** Conditions on a test (its steps with something going wrong); they run right away. */
export async function addConditionsAction(testId: string, conditions: string[]): Promise<{ error?: string }> {
  const t = await ownTest(testId);
  if (t.baseId) return { error: "Add conditions on the test, not on a condition." };
  if (walletUse(t.steps) !== "signs") return { error: "Conditions need a test that asks the wallet to sign." };
  const picked = conditions.map((c) => EdgeCaseId.safeParse(c)).flatMap((r) => (r.success && OFFERED_CONDITIONS.some((c) => c.id === r.data) ? [r.data] : []));
  if (picked.length === 0) return { error: "Pick at least one." };
  const ids = await addConditions(db(), testId, picked);
  await run(t.appId, ids);
  refresh(t.appId);
  return {};
}

export async function deleteTestAction(testId: string): Promise<void> {
  const t = await ownTest(testId);
  await db().update(testRuns).set({ stopRequested: true }).where(and(eq(testRuns.testId, testId), eq(testRuns.status, "running")));
  await db().delete(tests).where(eq(tests.id, testId));
  refresh(t.appId);
  redirect(`/apps/${t.appId}`);
}
