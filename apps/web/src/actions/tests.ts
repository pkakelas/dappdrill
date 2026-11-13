"use server";

import { sentence, Test, type Action, type Check } from "@dappdrill/core";
import { db, makes, queueRuns, testOf, testRuns, tests, touched, type Trigger } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enqueue } from "@/lib/jobs";
import { startMake } from "@/lib/make";
import { looksLikeKey } from "@/lib/secrets";
import { requireApp } from "@/lib/session";

async function ownTest(testId: string) {
  const [t] = await db().select().from(tests).where(eq(tests.id, testId));
  if (!t) throw new Error("That test no longer exists.");
  await requireApp(t.appId);
  return t;
}

/** Queues a run of the tests. `url` runs them against another deploy of the app instead of its own URL. */
async function run(appId: string, testIds: string[], trigger: Trigger = "manual", url?: string) {
  // A test already queued or running isn't queued twice.
  const busy = testIds.length
    ? await db()
        .select({ id: testRuns.testId })
        .from(testRuns)
        .where(and(inArray(testRuns.testId, testIds), inArray(testRuns.status, ["queued", "running"])))
    : [];
  const ids = testIds.filter((id) => !busy.some((b) => b.id === id));
  const batchId = await queueRuns(db(), appId, ids, trigger, url);
  if (batchId) await enqueue("tests.run", { batchId });
}

const allIds = async (appId: string) => (await db().select({ id: tests.id }).from(tests).where(eq(tests.appId, appId))).map((t) => t.id);

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
  await run(appId, await allIds(appId));
  refresh(appId);
}

const DeployUrl = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/, error: "Give the deploy's address, starting with http:// or https://." }));

/** Runs every test against another deploy of the app (a preview, staging) with the app's own tests and what they recorded. */
export async function runAgainstUrlAction(appId: string, url: string): Promise<{ error?: string }> {
  await requireApp(appId);
  const parsed = DeployUrl.safeParse(url);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await run(appId, await allIds(appId), "manual", parsed.data);
  refresh(appId);
  return {};
}

/** Stops the app's runs, or those of the given tests. A batch shares one browser setup, so the worker stops the whole batch a running test is in. */
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

// ---------------------------------------------------------------- making

const BUSY = "Tests are being made for this app already. Add this one when that's done.";

/** Looks over the app and makes a test for each goal it finds. */
export async function makeTestsAction(appId: string): Promise<void> {
  const { user } = await requireApp(appId);
  await startMake(appId, user.id);
  refresh(appId);
}

const Goal = z.string().trim().min(8, "Say what a user does and what they should see, in a sentence.").max(600);

/** Makes one test from a goal in the user's words: it is done once, written as lines, then run until it goes the same way twice. */
export async function makeTestAction(appId: string, goal: string): Promise<{ error?: string }> {
  const { user } = await requireApp(appId);
  const parsed = Goal.safeParse(goal);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (looksLikeKey(parsed.data)) return { error: "That looks like a private key. Take it out: this text isn't encrypted." };
  if (!(await startMake(appId, user.id, parsed.data))) return { error: BUSY };
  refresh(appId);
  return {};
}

export async function stopMakeAction(makeId: string): Promise<void> {
  const [make] = await db().select({ appId: makes.appId }).from(makes).where(eq(makes.id, makeId));
  if (!make) return;
  await requireApp(make.appId);
  await db().update(makes).set({ stopRequested: true }).where(eq(makes.id, makeId));
  refresh(make.appId);
}

// ---------------------------------------------------------------- editing

const Edit = z.object({
  name: z.string().trim().min(1, "Give the test a name.").max(120),
  goal: z.string().trim().min(1, "Say what the user is after.").max(600),
  startPath: z.string().trim().max(500).regex(/^\//, "The start page is a path on the app, like /vault."),
  lines: z
    .array(z.object({ type: z.enum(["action", "check"]), text: z.string().trim().min(1, "A line can't be empty.").max(600) }))
    .min(1, "A test needs at least one line.")
    .max(60),
});
export type TestEdit = z.input<typeof Edit>;

/**
 * Saves a test edited by hand. A line whose words didn't change stays as it was, with what it
 * recorded. A new or reworded action is done by a model on the next run, which records it; a new
 * or reworded check is answered by a model from then on. Nothing proves the edit: the next run does.
 */
export async function saveTestAction(testId: string, input: TestEdit): Promise<{ error?: string }> {
  const row = await ownTest(testId);
  const parsed = Edit.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const edit = parsed.data;
  if (edit.lines.some((l) => looksLikeKey(l.text))) return { error: "A line looks like a private key. Take it out: this text isn't encrypted." };

  const before = testOf(row);
  const left = [...before.steps];
  const steps = edit.lines.map((line): Action | Check => {
    const same = left.findIndex((old) => old.type === line.type && sentence(old) === line.text);
    if (same >= 0) return left.splice(same, 1)[0]!;
    return line.type === "action" ? { type: "action", by: "code", do: line.text, run: [] } : { type: "check", by: "llm", claim: line.text };
  });
  const next = Test.safeParse({ ...before, name: edit.name, goal: edit.goal, startPath: edit.startPath, steps });
  if (!next.success) return { error: next.error.issues[0]?.message };
  await db()
    .update(tests)
    .set({ name: next.data.name, goal: next.data.goal, startPath: next.data.startPath, steps: next.data.steps, ...touched() })
    .where(eq(tests.id, testId));
  refresh(row.appId);
  return {};
}

export async function deleteTestAction(testId: string): Promise<void> {
  const t = await ownTest(testId);
  await db().update(testRuns).set({ stopRequested: true }).where(and(eq(testRuns.testId, testId), eq(testRuns.status, "running")));
  await db().delete(tests).where(eq(tests.id, testId));
  refresh(t.appId);
  redirect(`/apps/${t.appId}`);
}
