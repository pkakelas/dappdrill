"use server";

import { sentence, Test, type Action, type Check, type Fund } from "@dappdrill/core";
import { accountOf, addTest, appTests, db, makes, queueRepair, queueRuns, repairAsk, settledRuns, testOf, testRuns, tests, touched, type apps, type Trigger } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enqueue } from "@/lib/jobs";
import { NO_PAYER, readFund, type FundRow } from "@/lib/funds";
import { isCode, unwritten } from "@/lib/lines";
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
  const own = await db()
    .select({ id: tests.id })
    .from(tests)
    .where(and(eq(tests.appId, appId), inArray(tests.id, testIds)));
  await run(
    appId,
    own.map((t) => t.id),
  );
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

/** Runs every test, or the ones named, against another deploy of the app (a preview, staging) with the app's own tests and what they recorded. */
export async function runAgainstUrlAction(appId: string, url: string, testIds?: string[]): Promise<{ error?: string }> {
  await requireApp(appId);
  const parsed = DeployUrl.safeParse(url);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const all = await allIds(appId);
  await run(appId, testIds ? all.filter((id) => testIds.includes(id)) : all, "manual", parsed.data);
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

/** A goal a finished make left without a test, by the make and its place in the make's list. */
export interface GoalRef {
  makeId: string;
  index: number;
}

/** Takes a goal off the app's list of goals without a test. Only a finished make's goals: the worker writes a running make's state. */
async function dismissGoal(appId: string, { makeId, index }: GoalRef) {
  const [make] = await db()
    .select()
    .from(makes)
    .where(and(eq(makes.id, makeId), eq(makes.appId, appId)));
  const goal = make?.state.goals[index];
  if (!make || !goal || goal.status !== "not-kept" || make.status === "queued" || make.status === "running") return;
  goal.dismissed = true;
  await db().update(makes).set({ state: make.state }).where(eq(makes.id, makeId));
}

/**
 * What a test's new account starts with, as its forms send it: nothing said (null) is what the app sends every
 * new account, no rows is an account that holds nothing. Only an app on new accounts with a key to pay from can say.
 */
function startsWith(app: typeof apps.$inferSelect, rows: FundRow[] | null | undefined): { fund?: Fund[] } | { error: string } {
  if (!rows || accountOf(app) !== "new") return {};
  const fund = readFund(rows.slice(0, 8));
  if ("error" in fund) return fund;
  if (fund.length > 0 && !app.liveKeyEnc) return { error: NO_PAYER };
  return { fund };
}

/**
 * Makes one test from a goal in the user's words: it is done once, written as lines, then run until it goes the same way twice.
 * `retries` is the goal without a test this one tries again, which leaves the list once the new make has started: the new make
 * starts with what that one did. `starts` is what the test's new account starts with, when the user said.
 */
export async function makeTestAction(appId: string, goal: string, retries?: GoalRef, starts?: FundRow[] | null): Promise<{ error?: string }> {
  const { user, app } = await requireApp(appId);
  const parsed = Goal.safeParse(goal);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (looksLikeKey(parsed.data)) return { error: "That looks like a private key. Take it out: this text isn't encrypted." };
  const own = startsWith(app, starts);
  if ("error" in own) return own;
  const [tried] =
    retries && !own.fund
      ? await db()
          .select()
          .from(makes)
          .where(and(eq(makes.id, retries.makeId), eq(makes.appId, appId)))
      : [];
  if (!(await startMake(appId, user.id, parsed.data, own.fund ?? tried?.state.fund))) return { error: BUSY };
  if (retries) await dismissGoal(appId, retries);
  refresh(appId);
  return {};
}

export async function dismissGoalAction(appId: string, goal: GoalRef): Promise<void> {
  await requireApp(appId);
  await dismissGoal(appId, goal);
  refresh(appId);
}

/** A test the owner added whose making broke on our side, and nothing came of it. A make that is going is the worker's to write. */
async function lostMake(makeId: string) {
  const [make] = await db().select().from(makes).where(eq(makes.id, makeId));
  if (!make) return;
  const { user } = await requireApp(make.appId);
  return make.goal && make.status === "failed" && !make.state.dismissed ? { make, goal: make.goal, user } : undefined;
}

const letGo = (make: typeof makes.$inferSelect) =>
  db()
    .update(makes)
    .set({ state: { ...make.state, dismissed: true } })
    .where(eq(makes.id, make.id));

/** Generates such a test again, as it was asked for and with what its account was to start with. The one that broke leaves the page. */
export async function retryMakeAction(makeId: string): Promise<{ error?: string }> {
  const lost = await lostMake(makeId);
  if (!lost) return {};
  if (!(await startMake(lost.make.appId, lost.user.id, lost.goal, lost.make.state.fund))) return { error: BUSY };
  await letGo(lost.make);
  refresh(lost.make.appId);
  return {};
}

/** Takes such a test off what waits for the owner, without trying it again. */
export async function dismissMakeAction(makeId: string): Promise<void> {
  const lost = await lostMake(makeId);
  if (!lost) return;
  await letGo(lost.make);
  refresh(lost.make.appId);
}

export async function stopMakeAction(makeId: string): Promise<void> {
  const [make] = await db().select({ appId: makes.appId }).from(makes).where(eq(makes.id, makeId));
  if (!make) return;
  await requireApp(make.appId);
  await db().update(makes).set({ stopRequested: true }).where(eq(makes.id, makeId));
  refresh(make.appId);
}

// ---------------------------------------------------------------- repairing

/**
 * Starts a repair: the setup and the reset are written as code again where they need it, then the tests
 * named. With none named, every test whose last result says it needs repairing or that has a line not
 * written as code yet. The tests are run once afterwards.
 */
export async function repairTestsAction(appId: string, testIds?: string[]): Promise<{ error?: string }> {
  const { app, user } = await requireApp(appId);
  const rows = await appTests(db(), appId);
  let ask: { testIds: string[]; then: string[] };
  if (testIds) {
    const own = rows.filter((t) => testIds.includes(t.id)).map((t) => t.id);
    ask = { testIds: own, then: own };
  } else {
    const settled = await settledRuns(
      db(),
      rows.map((t) => t.id),
    );
    const stopped = repairAsk([...settled.values()].flatMap((r) => (r.result ? [{ testId: r.testId, repairable: Boolean(r.result.repairable), steps: r.result.steps }] : [])));
    const waitingOnCode = rows.filter(unwritten).map((t) => t.id);
    // Every test starts with the setup and the reset, so all of them are run again once those are written.
    const before = [...(app.suite.setup?.steps ?? []), ...(app.suite.reset?.steps ?? [])];
    const waiting = before.every(isCode) ? stopped.then : rows.map((t) => t.id);
    ask = { testIds: [...new Set([...stopped.testIds, ...waitingOnCode])], then: [...new Set([...waiting, ...waitingOnCode])] };
  }
  if (ask.then.length === 0) return { error: "Nothing needs repairing." };
  const repairId = await queueRepair(db(), appId, ask, { userId: user.id });
  if (!repairId) return { error: "A repair is going for this app already." };
  await enqueue("repair.run", { repairId });
  refresh(appId);
  return {};
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
  /** What its new account starts with. Null: what the app sends every new account. */
  fund: z
    .array(z.object({ chainId: z.number().optional(), token: z.string(), amount: z.string() }))
    .nullable()
    .optional(),
});
export type TestEdit = z.input<typeof Edit>;

/**
 * Saves a test edited by hand. A line whose words didn't change stays as it was, with its code.
 * A new or reworded line isn't code yet: a run stops at it and says the test needs repairing, and
 * the next repair writes it as code.
 */
export async function saveTestAction(testId: string, input: TestEdit): Promise<{ error?: string }> {
  const row = await ownTest(testId);
  const parsed = Edit.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const edit = parsed.data;
  const { app } = await requireApp(row.appId);
  // Left out of the form (a kept account), what the test had stays.
  const own = edit.fund === undefined ? { fund: row.fund ?? undefined } : startsWith(app, edit.fund);
  if ("error" in own) return own;
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
    .set({ name: next.data.name, goal: next.data.goal, startPath: next.data.startPath, steps: next.data.steps, fund: own.fund ?? null, ...touched() })
    .where(eq(tests.id, testId));
  refresh(row.appId);
  return {};
}

/** A copy of the test at the end of the list, opened for editing: the way to a variant of a test that works. */
export async function duplicateTestAction(testId: string): Promise<void> {
  const row = await ownTest(testId);
  const id = await addTest(db(), row.appId, { ...testOf(row), name: `${row.name.slice(0, 113)} (copy)` });
  refresh(row.appId);
  redirect(`/apps/${row.appId}/tests/${id}?edit`);
}

/** Deletes these tests of the app, with their results. */
export async function deleteTestsAction(appId: string, testIds: string[]): Promise<void> {
  await requireApp(appId);
  if (testIds.length === 0) return;
  const own = and(eq(tests.appId, appId), inArray(tests.id, testIds));
  await db()
    .update(testRuns)
    .set({ stopRequested: true })
    .where(and(eq(testRuns.appId, appId), inArray(testRuns.testId, testIds), eq(testRuns.status, "running")));
  await db().delete(tests).where(own);
  refresh(appId);
}

export async function deleteTestAction(testId: string): Promise<void> {
  const t = await ownTest(testId);
  await db()
    .update(testRuns)
    .set({ stopRequested: true })
    .where(and(eq(testRuns.testId, testId), eq(testRuns.status, "running")));
  await db().delete(tests).where(eq(tests.id, testId));
  refresh(t.appId);
  redirect(`/apps/${t.appId}`);
}
