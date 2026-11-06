import { db, explorations, listBatches, type Batch, type JobStatus } from "@dappdrill/db";
import { desc, eq, sql } from "drizzle-orm";
import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatus } from "@/components/tests/batch-status";
import { StateMark, type TestState } from "@/components/tests/status";
import { TINT } from "@/components/tests/tile";
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

interface PassRow {
  id: string;
  status: JobStatus;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  tests: number;
  bugs: number;
  tried: number;
  /** The first runs of the tests it saved, added up. */
  runs?: Batch;
}

/**
 * Each test an exploration saves runs straight away, in a batch of its own. On this page they are
 * one line with the exploration that started them, which leaves the list to the runs people asked for.
 */
function foldFirstRuns(batches: Batch[], passes: PassRow[]): Batch[] {
  return batches.filter((b) => {
    const pass = b.trigger === "explore" ? passes.find((p) => p.startedAt <= b.startedAt) : undefined;
    if (!pass) return true;
    const sum = (pass.runs ??= { ...b, total: 0, passed: 0, failed: 0, couldntRun: 0, skipped: 0, active: 0 });
    for (const k of ["total", "passed", "failed", "couldntRun", "skipped", "active"] as const) sum[k] += b[k];
    return false;
  });
}

/** Every time the app was explored. What came of it is counted in the database: a whole state is heavy. */
async function listPasses(appId: string): Promise<PassRow[]> {
  const n = (path: string) => sql<number>`coalesce(jsonb_array_length(jsonb_path_query_array(${explorations.state}, ${path}::jsonpath)), 0)`.mapWith(Number);
  const rows = await db()
    .select({
      id: explorations.id,
      status: explorations.status,
      error: explorations.error,
      startedAt: explorations.startedAt,
      createdAt: explorations.createdAt,
      finishedAt: explorations.finishedAt,
      tests: n('$.suggested[*] ? (@.status == "proved")'),
      bugs: n('$.bugs[*] ? (@.status == "confirmed")'),
      tried: n("$.checks[*]"),
    })
    .from(explorations)
    .where(eq(explorations.appId, appId))
    .orderBy(desc(explorations.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r, startedAt: r.startedAt ?? r.createdAt }));
}

function PassStatus({ pass: p }: { pass: PassRow }) {
  if (p.status === "queued") return <span className="text-live">Queued</span>;
  const found = [`${plural(p.tests, "test")} saved`, plural(p.bugs, "bug"), `${p.tried} tried`].join(" · ");
  if (p.status === "running")
    return (
      <>
        <span className="text-live">Running</span> · {found}
      </>
    );
  if (p.status === "failed")
    return (
      <>
        <span className="text-warn">Didn&apos;t finish</span>
        {p.error && `: ${p.error}`}
      </>
    );
  return (
    <>
      {p.status === "stopped" && "Stopped · "}
      {found}
    </>
  );
}

const ROW = "relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/40";

/** A run is a batch of results that started together; nothing is stored for it beyond those results. */
export default async function RunsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const [all, passes] = await Promise.all([listBatches(db(), appId, 200), listPasses(appId)]);
  const batches = foldFirstRuns(all, passes);
  const anyActive = all.some((b) => b.active > 0) || passes.some((p) => p.status === "queued" || p.status === "running");
  const rows = [...batches.map((batch) => ({ at: batch.startedAt, batch, pass: undefined })), ...passes.map((pass) => ({ at: pass.startedAt, batch: undefined, pass }))].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="page">
      {anyActive && <AutoRefresh every={2000} />}
      <PageHeader title="Runs" description={`Every time ${app.name} was explored or its tests ran: by you, by the assistant, after exploring, or on the daily schedule.`} />
      {rows.length === 0 ? (
        <Empty title="No runs yet">Run a test and it shows up here.</Empty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {rows.map(({ batch: b, pass: p }) =>
            b ? (
              <li key={b.batchId} className={ROW}>
                <StateMark state={batchMark(b)} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link href={`/apps/${appId}/runs/${b.batchId}`} className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
                    {TRIGGER_LABEL[b.trigger]}
                  </Link>
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
              <li key={p.id} className={ROW}>
                <span className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-lg", TINT.live)}>
                  <Compass className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {/* Only the latest exploration's log is on the app page. */}
                  {p.id === passes[0]?.id ? (
                    <Link href={`/apps/${appId}?tab=checks`} className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
                      Explored the app
                    </Link>
                  ) : (
                    <span className="font-medium">Explored the app</span>
                  )}
                  <span className="text-sm text-pretty text-muted-foreground">
                    <PassStatus pass={p} />
                  </span>
                  {p.runs && (
                    <span className="text-sm text-muted-foreground">
                      First runs: <BatchStatus batch={p.runs} />
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={dateTime(p.startedAt)}>
                  {timeAgo(p.startedAt)}
                  {p.finishedAt && ` · ${minutesBetween(p.startedAt, p.finishedAt)}`}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
