import { conditionInfo } from "@dappdrill/core";
import { appTests, db, listBatches, specOf, testRuns, tests } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alias } from "drizzle-orm/pg-core";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatus } from "@/components/tests/batch-status";
import { STATE_LABEL, STATE_TEXT, StateMark } from "@/components/tests/status";
import { cx, PageHeader } from "@/components/ui";
import { dateTime, minutesBetween, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Run" };

const base = alias(tests, "base");

/** One run: its results, one per test or condition, named Test · Condition, in page order. */
export default async function RunPage({ params }: { params: Promise<{ appId: string; batchId: string }> }) {
  const { appId, batchId } = await params;
  await requireApp(appId);
  const [batch] = (await listBatches(db(), appId, 500)).filter((b) => b.batchId === batchId);
  if (!batch) notFound();
  const [results, ordered] = await Promise.all([
    db()
      .select({ run: testRuns, test: tests, baseName: base.name })
      .from(testRuns)
      .innerJoin(tests, eq(tests.id, testRuns.testId))
      .leftJoin(base, eq(base.id, tests.baseId))
      .where(and(eq(testRuns.appId, appId), eq(testRuns.batchId, batchId))),
    appTests(db(), appId),
  ]);
  const rank = new Map(ordered.map((t, i) => [t.id, i]));
  results.sort((a, b) => rank.get(a.test.id)! - rank.get(b.test.id)!);

  return (
    <div className="page">
      {batch.active > 0 && <AutoRefresh every={2000} />}
      <PageHeader
        title={TRIGGER_LABEL[batch.trigger]}
        description={
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <Link href={`/apps/${appId}/runs`} className="hover:text-foreground hover:underline">
              Runs
            </Link>
            <span aria-hidden="true">/</span>
            <span title={dateTime(batch.startedAt)}>{timeAgo(batch.startedAt)}</span>
            {batch.finishedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>took {minutesBetween(batch.startedAt, batch.finishedAt)}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <BatchStatus batch={batch} />
          </p>
        }
      />
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {results.map(({ run, test, baseName }) => {
          const failure = run.result?.failure;
          return (
            <li key={run.id} className="relative flex items-center gap-3 px-5 py-3 hover:bg-accent/40">
              <StateMark state={run.status} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link href={`/apps/${appId}/tests/${test.id}?run=${run.id}`} className="truncate outline-none after:absolute after:inset-0 focus-visible:underline">
                  <span className="font-medium">{baseName ?? test.name}</span>
                  {test.condition && <span className="text-muted-foreground"> · {conditionInfo(test.condition).name}</span>}
                </Link>
                {failure && (run.status === "fail" || run.status === "error" || run.status === "skipped") && (
                  <span className={cx("truncate text-sm", run.status === "fail" ? "text-bad" : run.status === "error" ? "text-warn" : "text-muted-foreground")}>
                    {run.status === "skipped" ? `Doesn't apply: ${failure}` : failure}
                  </span>
                )}
              </div>
              <span className={cx("shrink-0 text-xs", STATE_TEXT[run.status])}>{STATE_LABEL[run.status]}</span>
              <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">{run.finishedAt ? timeAgo(run.finishedAt) : ""}</span>
              <span className="sr-only">{specOf(test).name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
