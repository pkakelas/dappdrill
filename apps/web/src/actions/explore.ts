"use server";

import { BugTriage, newId, type ExploreCheck } from "@dappdrill/core";
import { db, explorations, flows, NEW_TEST_NOTE, nextPosition, queueRuns, testRuns, tests } from "@dappdrill/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enqueue } from "@/lib/jobs";
import { requireApp } from "@/lib/session";

const Minutes = z.coerce.number().pipe(z.union([z.literal(15), z.literal(30), z.literal(60)]));

const refresh = (appId: string) => revalidatePath(`/apps/${appId}`, "layout");

async function ownExploration(explorationId: string) {
  const [row] = await db().select().from(explorations).where(eq(explorations.id, explorationId));
  if (!row) throw new Error("That exploration no longer exists.");
  await requireApp(row.appId);
  return row;
}

export async function startExplorationAction(appId: string, form: FormData): Promise<void> {
  await requireApp(appId);
  const [busy] = await db()
    .select({ id: explorations.id })
    .from(explorations)
    .where(and(eq(explorations.appId, appId), inArray(explorations.status, ["queued", "running"])));
  if (busy) return refresh(appId);
  const id = newId("exp");
  await db().insert(explorations).values({ id, appId, budgetMinutes: Minutes.parse(form.get("minutes")) });
  await enqueue("exploration.run", { explorationId: id });
  refresh(appId);
}

export async function stopExplorationAction(explorationId: string): Promise<void> {
  const row = await ownExploration(explorationId);
  await db().update(explorations).set({ stopRequested: true }).where(eq(explorations.id, row.id));
  refresh(row.appId);
}

/** Written as one key, so two people triaging different bugs don't overwrite each other. */
export async function triageBugAction(explorationId: string, bugId: string, triage: string): Promise<void> {
  const row = await ownExploration(explorationId);
  if (!row.state?.bugs.some((b) => b.id === bugId)) throw new Error("That bug no longer exists.");
  const entry = JSON.stringify({ [bugId]: BugTriage.parse(triage) });
  await db().update(explorations).set({ triage: sql`${explorations.triage} || ${entry}::jsonb` }).where(eq(explorations.id, row.id));
  refresh(row.appId);
}

const WANTED: Record<ExploreCheck["assert"]["kind"], (value: string) => string> = {
  shows: (v) => `The page shows "${v}".`,
  hides: (v) => `The page doesn't show "${v}".`,
  url: (v) => `The address contains "${v}".`,
  wallet: (v) => `The wallet is asked to sign: ${v}.`,
  "no-wallet": () => "Nothing is sent to the wallet to sign.",
  tx: () => "The transaction is mined and doesn't revert.",
  balance: () => "The balance on the page matches the chain.",
};

/** A person's call: this check matters, whatever the rule said. It starts as a draft like any new test. */
export async function pinCheckAction(explorationId: string, checkId: string): Promise<void> {
  const row = await ownExploration(explorationId);
  const check = row.state?.checks.find((c) => c.id === checkId);
  if (!check) throw new Error("That check no longer exists.");
  const [taken] = await db().select({ id: tests.id }).from(tests).where(and(eq(tests.appId, row.appId), eq(tests.name, check.name)));
  if (taken) return refresh(row.appId);

  const [known] = await db().select({ id: flows.id }).from(flows).where(and(eq(flows.appId, row.appId), eq(flows.name, check.flow)));
  let flowId = known?.id;
  if (!flowId) {
    flowId = newId("flow");
    await db().insert(flows).values({ id: flowId, appId: row.appId, name: check.flow, goal: "", position: await nextPosition(db(), row.appId) });
  }
  const id = newId("test");
  await db()
    .insert(tests)
    .values({
      id,
      appId: row.appId,
      flowId,
      name: check.name,
      goal: check.name,
      expected: WANTED[check.assert.kind](check.assert.value ?? ""),
      startPath: check.startPath,
      steps: check.path.map((text) => ({ text })),
      position: await nextPosition(db(), row.appId, flowId),
      draftNote: NEW_TEST_NOTE,
    });
  const batchId = await queueRuns(db(), row.appId, [id], "manual");
  if (batchId) await enqueue("tests.run", { batchId });
  refresh(row.appId);
}

/** Deletes a test the exploration thinks is out of date, and stays on the report. */
export async function retireTestAction(explorationId: string, testId: string): Promise<void> {
  const row = await ownExploration(explorationId);
  await db().update(testRuns).set({ stopRequested: true }).where(and(eq(testRuns.testId, testId), eq(testRuns.status, "running")));
  await db().delete(tests).where(and(eq(tests.id, testId), eq(tests.appId, row.appId)));
  refresh(row.appId);
}

/** Repeats a finished exploration's checks. No model, so it's cheap. */
export async function sweepAction(explorationId: string): Promise<void> {
  const row = await ownExploration(explorationId);
  await enqueue("sweep.run", { explorationId: row.id });
  refresh(row.appId);
}
