import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { keepActions } from "@dappdrill/core";
import { queueRuns, sentenceName, specOf, tests, touched, type Db } from "@dappdrill/db";
import type { Engine } from "@dappdrill/engine/fake";
import { errorMessage, logger } from "../log.js";
import { QUEUES, type TestsJob } from "../queues.js";
import { loadApp } from "../target.js";

/**
 * test-draft.run: write a test from the developer's sentence (`drafting`), then run it.
 * A fork starts from the test it was forked from; a test that already has steps is rewritten.
 * If writing fails the row keeps the sentence as its goal, so nothing typed is lost.
 */
export async function runDraft(db: Db, engine: Engine, boss: PgBoss, testId: string): Promise<void> {
  const log = logger(`draft ${testId}`);
  const [test] = await db.select().from(tests).where(eq(tests.id, testId));
  if (!test?.drafting) return log.warn("nothing to write; skipping");
  const app = await loadApp(db, test.appId);
  const [forked] = test.forkedFrom ? await db.select().from(tests).where(eq(tests.id, test.forkedFrom)) : [];
  const base = forked ?? (test.steps.length ? test : undefined);
  // A test the analysis found already has its name; one from a sentence takes the writer's.
  const named = !base && test.name !== sentenceName(test.drafting);

  try {
    const { draft } = await engine.writeTest({ prompt: test.drafting, map: app.map ?? undefined, base: base && specOf(base) });
    await db
      .update(tests)
      .set({
        name: named ? test.name : draft.name,
        goal: draft.goal,
        expected: draft.expected,
        startPath: draft.startPath,
        steps: keepActions(draft.steps, base?.steps ?? []),
        // The proof belonged to the old expected result.
        proof: base && base.expected === draft.expected ? base.proof : null,
        drafting: null,
        ...touched(),
      })
      .where(eq(tests.id, testId));
  } catch (e) {
    log.error("could not write the test", e);
    await db.update(tests).set({ drafting: null, ...(test.steps.length ? {} : { goal: test.drafting }) }).where(eq(tests.id, testId));
    return;
  }
  log.info("written; running it");
  const batchId = await queueRuns(db, app.id, [testId], "manual");
  if (batchId) await boss.send(QUEUES.tests, { batchId } satisfies TestsJob).catch((e) => log.warn(`could not queue the run: ${errorMessage(e)}`));
}
