import { appTests, db, listBatches, testRuns, tests } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatus } from "@/components/tests/batch-status";
import { STATE_LABEL, STATE_TEXT, StateMark } from "@/components/tests/status";
import { cx, PageHeader } from "@/components/ui";
import { dateTime, minutesBetween, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Params = { appId: string; batchId: string };

const load = cache(async (appId: string, batchId: string) => {
  await requireApp(appId);
  const [batch] = (await listBatches(db(), appId, 500)).filter((b) => b.batchId === batchId);
  if (!batch) notFound();
  return batch;
});

/** The tab says which run: there are often several open side by side. */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { appId, batchId } = await params;
  const batch = await load(appId, batchId);
  return { title: `${TRIGGER_LABEL[batch.trigger]}, ${dateTime(batch.startedAt)}` };
}

/** One run: its results, one per test, in page order. */
export default async function RunPage({ params }: { params: Promise<Params> }) {
  const { appId, batchId } = await params;
  const batch = await load(appId, batchId);
  const [results, ordered] = await Promise.all([
    db()
      .select({ run: testRuns, test: tests })
      .from(testRuns)
      .innerJoin(tests, eq(tests.id, testRuns.testId))
      .where(and(eq(testRuns.appId, appId), eq(testRuns.batchId, batchId))),
    appTests(db(), appId),
  ]);
  const rank = new Map(ordered.map((t, i) => [t.id, i]));
  results.sort((a, b) => rank.get(a.test.id)! - rank.get(b.test.id)!);

  return (
    <div className="page">
      {batch.active > 0 && <AutoRefresh every={2000} />}
      <Link href={`/apps/${appId}/runs`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All runs
      </Link>
      <PageHeader
        title={TRIGGER_LABEL[batch.trigger]}
        description={
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
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
        {results.map(({ run, test }) => {
          const reason = run.result?.reason;
          return (
            <li key={run.id} className="relative flex items-center gap-3 px-5 py-3 hover:bg-accent/40">
              <StateMark state={run.status} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link href={`/apps/${appId}/tests/${test.id}?run=${run.id}`} className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
                  {test.name}
                </Link>
                {reason && (run.status === "failed" || run.status === "unverified") && <span className={cx("truncate text-sm", run.status === "failed" ? "text-bad" : "text-warn")}>{reason}</span>}
              </div>
              <span className={cx("shrink-0 text-xs", STATE_TEXT[run.status])}>{STATE_LABEL[run.status]}</span>
              <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">{run.finishedAt ? timeAgo(run.finishedAt) : ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
