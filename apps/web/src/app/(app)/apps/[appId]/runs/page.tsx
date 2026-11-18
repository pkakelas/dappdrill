import { db, listBatches, makes, type Batch } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { ListPlus, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatus } from "@/components/tests/batch-status";
import { StateMark, type TestState } from "@/components/tests/status";
import { TINT } from "@/components/tests/tile";
import { cx, Empty, PageHeader } from "@/components/ui";
import { dateTime, hostFromUrl, minutesBetween, plainError, plural, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Runs" };

type MakeRow = typeof makes.$inferSelect & { at: Date; proof?: Batch };

/** The worst thing in a run, or what it's doing now. */
function batchMark(b: Batch): TestState {
  if (b.active > 0) return "running";
  if (b.failed > 0) return "failed";
  if (b.unverified > 0) return "unverified";
  return b.passed > 0 ? "passed" : "stopped";
}

/**
 * The run that proved each test a make kept is that test's first result, in a batch of its own.
 * On this page it is one line with the make it came from, which leaves the list to the runs people asked for.
 */
function foldProofs(batches: Batch[], made: MakeRow[]): Batch[] {
  return batches.filter((b) => {
    const make = b.trigger === "make" ? made.find((m) => !m.state.repair && m.at <= b.startedAt) : undefined;
    if (!make || make.proof) return true;
    make.proof = b;
    return false;
  });
}

/** What a make came to: the tests it kept, the bugs it found, the goals left without a test. For a repair, how many of its tests were written as code again. */
function outcome(m: MakeRow): string {
  const repair = m.state.repair;
  if (repair) return repair.tests.length > 0 ? `${repair.tests.filter((t) => t.status === "repaired").length} of ${plural(repair.tests.length, "test")} repaired` : "The setup written as code";
  const goals = m.state.goals;
  // A test kept because it fails on a bug is counted as the bug, as the app page counts it.
  const bugs = goals.filter((g) => g.status === "kept" && g.stands === "failed").length;
  const kept = goals.filter((g) => g.status === "kept").length - bugs;
  const none = goals.filter((g) => g.status === "not-kept").length;
  return [`${plural(kept, "test")} kept`, bugs > 0 && `${plural(bugs, "bug")} found`, none > 0 && `${none} without a test`].filter(Boolean).join(" · ");
}

/** The line under a make or a repair: where it is, or what came of it. */
function MakeStatus({ make: m, appUrl }: { make: MakeRow; appUrl: string }) {
  if (m.status === "queued") return <span className="text-live">Queued</span>;
  if (m.status === "running")
    return (
      <>
        <span className="text-live">Running</span> · {outcome(m)}
      </>
    );
  if (m.status === "failed")
    return (
      <>
        <span className="text-warn">Didn&apos;t finish</span>
        {m.error && `: ${plainError(m.error, appUrl)}`}
      </>
    );
  return (
    <>
      {m.status === "stopped" && "Stopped · "}
      {outcome(m)}
    </>
  );
}

function makeTitle(m: MakeRow) {
  const going = m.status === "queued" || m.status === "running";
  if (m.state.repair) return going ? "Repairing tests" : "Repaired tests";
  if (m.goal) return going ? "Making a test" : "Made a test";
  return going ? "Making tests" : "Made tests";
}

const ROW = "relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/40";

/** A run is a batch of results that started together; nothing is stored for it beyond those results. */
export default async function RunsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const [all, madeRows] = await Promise.all([listBatches(db(), appId, 200), db().select().from(makes).where(eq(makes.appId, appId)).orderBy(desc(makes.createdAt)).limit(50)]);
  const made: MakeRow[] = madeRows.map((m) => ({ ...m, at: m.startedAt ?? m.createdAt }));
  const batches = foldProofs(all, made);
  const anyActive = all.some((b) => b.active > 0) || made.some((m) => m.status === "queued" || m.status === "running");
  const rows = [...batches.map((batch) => ({ at: batch.startedAt, batch, make: undefined })), ...made.map((make) => ({ at: make.at, batch: undefined, make }))].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="page">
      {anyActive && <AutoRefresh every={2000} />}
      <PageHeader title="Runs" description={`Every time ${app.name}'s tests were made, repaired or ran: by you, or on the daily schedule.`} />
      {rows.length === 0 ? (
        <Empty title="No runs yet">Run a test and it shows up here.</Empty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {rows.map(({ batch: b, make: m }) =>
            b ? (
              <li key={b.batchId} className={ROW}>
                <StateMark state={batchMark(b)} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <Link href={`/apps/${appId}/runs/${b.batchId}`} className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
                      {TRIGGER_LABEL[b.trigger]}
                    </Link>
                    {/* A batch against another deploy (a preview, staging) says which. */}
                    {b.url && (
                      <span className="truncate text-sm text-muted-foreground" title={b.url}>
                        against {hostFromUrl(b.url)}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <BatchStatus batch={b} />
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={dateTime(b.startedAt)}>
                  {plural(b.total, "result")} · {timeAgo(b.startedAt)}
                  {b.finishedAt && ` · ${minutesBetween(b.startedAt, b.finishedAt)}`}
                </span>
              </li>
            ) : (
              <li key={m.id} className={ROW}>
                <span className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-lg", m.state.repair ? TINT.violet : TINT.live)}>
                  {m.state.repair ? <Wrench className="size-4" aria-hidden="true" /> : <ListPlus className="size-4" aria-hidden="true" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {/* The results of the tests it kept or repaired, when there are any; the app page has the rest. */}
                  <Link href={m.proof || m.state.repair?.batchId ? `/apps/${appId}/runs/${m.proof?.batchId ?? m.state.repair?.batchId}` : `/apps/${appId}`} className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
                    {makeTitle(m)}
                  </Link>
                  <span className="text-sm text-pretty text-muted-foreground">
                    <MakeStatus make={m} appUrl={app.url} />
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={dateTime(m.at)}>
                  {timeAgo(m.at)}
                  {m.finishedAt && ` · ${minutesBetween(m.at, m.finishedAt)}`}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
