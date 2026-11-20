import { appTests, db, listBatches, testRuns, tests } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatus } from "@/components/tests/batch-status";
import { STATE_LABEL, STATE_TEXT, StateMark, shortReason } from "@/components/tests/status";
import { cx } from "@/components/ui";
import { dateTime, hostFromUrl, minutesBetween, timeAgo, TRIGGER_LABEL } from "@/lib/format";
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
  return {
    title: `${TRIGGER_LABEL[batch.trigger]}, ${dateTime(batch.startedAt)}`,
  };
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
    <div className="page flex flex-col gap-8">
      {batch.active > 0 && <AutoRefresh every={2000} />}
      <header className="flex flex-col gap-5">
        <Link href={`/apps/${appId}/runs`} className="-ml-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Runs
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-pretty">
            {TRIGGER_LABEL[batch.trigger]}
            {batch.url && <span className="font-normal text-muted-foreground"> against {hostFromUrl(batch.url)}</span>}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
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
        </div>
      </header>
      <ul className="divide-y rounded-xl border bg-card shadow-xs">
        {results.map(({ run, test }) => {
          const reason = run.result?.reason;
          return (
            <li key={run.id} className="p-1.5">
              <div className="relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-foreground/[0.04]">
                <StateMark state={run.status} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link href={`/apps/${appId}/tests/${test.id}?run=${run.id}`} className="truncate font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
                    {test.name}
                  </Link>
                  {reason && (run.status === "failed" || run.status === "unverified") && (
                    <span className={cx("truncate text-xs", run.status === "failed" ? "text-bad" : "text-muted-foreground")}>
                      {run.result?.repairable && "Needs repair · "}
                      {shortReason(reason, run.status === "failed")}
                    </span>
                  )}
                </div>
                <span className={cx("shrink-0 text-xs", STATE_TEXT[run.status])}>{STATE_LABEL[run.status]}</span>
                <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">{run.finishedAt ? timeAgo(run.finishedAt) : ""}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
