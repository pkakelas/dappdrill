import { db, listBatches, type Batch } from "@dappdrill/db";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatus } from "@/components/tests/batch-status";
import { StateMark, type TestState } from "@/components/tests/status";
import { cx, Empty, PageHeader } from "@/components/ui";
import { dateTime, minutesBetween, plural, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Runs" };

/** The worst thing in a run, or what it's doing now. */
function batchMark(b: Batch): TestState {
  if (b.active > 0) return "running";
  if (b.failed > 0) return "fail";
  if (b.couldntRun > 0) return "error";
  return b.passed > 0 ? "pass" : "skipped";
}

/** A run is a batch of results that started together; nothing is stored for it beyond those results. */
export default async function RunsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const batches = await listBatches(db(), appId);
  const anyActive = batches.some((b) => b.active > 0);

  return (
    <div className="page">
      {anyActive && <AutoRefresh every={2000} />}
      <PageHeader title="Runs" description={`Every time ${app.name}'s tests ran: by you, by the assistant, after exploring, or on the daily schedule.`} />
      {batches.length === 0 ? (
        <Empty title="No runs yet">Run a test and it shows up here.</Empty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {batches.map((b) => (
            <li key={b.batchId} className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/40">
              <StateMark state={batchMark(b)} size="lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link href={`/apps/${appId}/runs/${b.batchId}`} className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
                  {TRIGGER_LABEL[b.trigger]}
                </Link>
                <span className="text-sm text-muted-foreground">
                  <BatchStatus batch={b} />
                </span>
              </div>
              <span className={cx("shrink-0 text-xs text-muted-foreground tabular-nums")} title={dateTime(b.startedAt)}>
                {plural(b.total, "result")} · {timeAgo(b.startedAt)}
                {b.finishedAt && ` · ${minutesBetween(b.startedAt, b.finishedAt)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
