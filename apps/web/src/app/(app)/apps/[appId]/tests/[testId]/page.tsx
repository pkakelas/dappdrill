import { formatDuration, sentence, type LineResult } from "@dappdrill/core";
import { db, testOf, testRuns, tests, type TestRunRow } from "@dappdrill/db";
import { and, desc, eq } from "drizzle-orm";
import { Bug, ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { TestEditor } from "@/components/tests/lines-editor";
import { SigningReviews } from "@/components/tests/run-details";
import { Evidence } from "@/components/tests/signed";
import { LINE_LABEL, LINE_STATE, readLabel, readTest, STATE_LABEL, STATE_TEXT, StateMark, shortReason } from "@/components/tests/status";
import { TestActions } from "@/components/tests/test-actions";
import { TestRunView, type ViewLine } from "@/components/tests/test-run-view";
import { cx } from "@/components/ui";
import { artifactUrl } from "@/lib/artifacts";
import { timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Params = { appId: string; testId: string };
type Line = ReturnType<typeof testOf>["steps"][number];

async function load(appId: string, testId: string) {
  const { app } = await requireApp(appId);
  const [test] = await db()
    .select()
    .from(tests)
    .where(and(eq(tests.id, testId), eq(tests.appId, appId)));
  if (!test) notFound();
  return { test, app };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { appId, testId } = await params;
  return { title: (await load(appId, testId)).test.name };
}

const SETTLED = new Set<TestRunRow["status"]>(["passed", "failed", "unverified"]);

/** A line's words with this run's values in place of their names, so the page reads as what was done. */
function filled(text: string, values?: Record<string, string>) {
  if (!values) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}

/** The lines with how each went in the run on screen. While a run is on, the first line with no result yet is the one being done. */
function viewLines(prefix: string, lines: Line[], results: LineResult[] | undefined, url: (p?: string | null) => string | null, values?: Record<string, string>, running?: boolean): ViewLine[] {
  const at = running && results ? results.findIndex((r) => r.status === "skipped") : -1;
  return lines.map((line, i) => {
    const r = results?.[i];
    const bad = r?.status === "fail" || r?.status === "unsure";
    return {
      key: `${prefix}${i}`,
      kind: line.type === "check" ? "check" : "action",
      text: filled(sentence(line), values),
      state: i === at ? "running" : r ? LINE_STATE[r.status] : "never",
      label: i === at ? "Running" : r ? LINE_LABEL[r.status] : "No result",
      note: r?.note && (bad || line.type === "check") ? r.note : undefined,
      tone: r?.status === "fail" ? "bad" : r?.status === "unsure" ? "warn" : "quiet",
      redone: r?.redone,
      did: bad ? r?.did : undefined,
      shot: url(r?.screenshot),
    };
  });
}

export default async function TestPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ run?: string; edit?: string }> }) {
  const { appId, testId } = await params;
  const { run: runParam, edit } = await searchParams;
  const { test, app } = await load(appId, testId);
  const history = await db().select().from(testRuns).where(eq(testRuns.testId, test.id)).orderBy(desc(testRuns.createdAt)).limit(15);

  const spec = testOf(test);
  const latest = history[0];
  // The status reads from the latest finished result; a queued, running or stopped run shows beside it.
  const settled = history.find((r) => SETTLED.has(r.status));
  const state = readTest(latest, settled);
  const picked = runParam ? history.find((r) => r.id === runParam) : undefined;
  // While a run is on, the page follows it; otherwise it shows the last result.
  const run = picked ?? (state.active ? latest : (settled ?? latest));
  const viewingOld = picked && picked.id !== latest?.id && picked.id !== settled?.id;
  const result = run?.result ?? undefined;
  const url = (path?: string | null) => (run ? artifactUrl("runs", run.batchId, path) : null);
  // Lines edited since the run no longer line up with its results.
  const lined = result && result.steps.length === spec.steps.length ? result.steps : undefined;
  // The run on screen failed and the test was kept for a bug: the bug is the explanation.
  const onBug = run?.status === "failed" && test.faults.length > 0;
  const editing = edit !== undefined && !state.active;
  const here = `/apps/${appId}/tests/${test.id}`;

  const running = run?.status === "running";
  const lines = viewLines("l", spec.steps, lined, url, result?.values, running);
  const ranCleanup = result?.cleanup && result.cleanup.length === spec.cleanup.length ? result.cleanup : undefined;
  const cleanupFailed = ranCleanup?.some((s) => s.status !== "pass");
  const wrong = lines.find((l) => l.state === "failed" || l.state === "unverified");
  // A failure counts once a second run goes the same way; when the first went another way, that is worth a line.
  const firstOther = result?.rerun && result.firstReason && result.firstReason !== result.reason ? shortReason(result.firstReason, true) : undefined;

  return (
    <div className="page flex flex-col gap-10">
      {state.active && <AutoRefresh every={2000} />}

      <header className="flex flex-col gap-6">
        <Link href={`/apps/${appId}`} className="-ml-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Tests
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-pretty">{test.name}</h1>
            <p className="max-w-3xl leading-relaxed text-pretty text-muted-foreground">{test.goal}</p>
          </div>
          <TestActions appId={appId} testId={test.id} active={Boolean(state.active)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-y py-3 text-sm">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StateMark state={state.mark} />
            <span className={cx("font-medium", STATE_TEXT[state.mark])}>
              {readLabel(state)}
              {/* Where it went wrong; that line is picked below, with what it found. */}
              {wrong && !state.active && run?.id === settled?.id && ` at line ${lines.indexOf(wrong) + 1}`}
            </span>
            {settled?.finishedAt && <span className="text-muted-foreground">· {timeAgo(settled.finishedAt)}</span>}
            {settled?.result && <span className="text-muted-foreground">· took {formatDuration(settled.result.durationMs)}</span>}
          </p>
          {history.length > 1 && <Results here={here} runs={history} selected={run?.id} />}
        </div>
      </header>

      {editing ? (
        <TestEditor testId={test.id} back={here} test={{ name: test.name, goal: test.goal, startPath: test.startPath, lines: spec.steps.map((l) => ({ type: l.type, text: sentence(l) })) }} />
      ) : (
        <>
          {viewingOld && run && (
            <div className="-mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
              <span>
                Showing the result from {timeAgo(run.createdAt)}: {STATE_LABEL[run.status].toLowerCase()}.
              </span>
              <Link href={here} className="font-medium text-foreground hover:underline">
                Back to the latest
              </Link>
            </div>
          )}

          {/* A reason that is a line's is said by that line, below. Only one that isn't (blocked, a dangerous signature, a page error) gets said here. */}
          {result?.reason && run && !wrong && (run.status === "unverified" || (run.status === "failed" && !onBug)) && (
            <div role="status" className={cx("-mt-4 rounded-xl px-5 py-4 leading-relaxed", run.status === "failed" ? "bg-bad-soft text-bad-ink" : "bg-warn-soft text-warn-ink")}>
              <Evidence text={result.reason} textClassName="text-pretty [overflow-wrap:anywhere]" />
            </div>
          )}
          {firstOther && <p className="-mt-6 text-sm text-muted-foreground">It was run twice before it counted. The first time: {firstOther}.</p>}

          {/* A failure on the bug the test was kept for is said once, as that bug. */}
          {test.faults.length > 0 && (
            <section className={cx("-mt-4 flex flex-col gap-4 rounded-xl p-5", onBug ? "bg-bad-soft" : "border")}>
              <h2 className={cx("flex items-center gap-2 text-sm font-medium", onBug ? "text-bad-ink" : "text-muted-foreground")}>
                <Bug className="size-4" aria-hidden="true" />
                {state.settled === "passed" ? "Kept because it failed on a bug in the app. It passes now." : "This test fails on a bug in the app"}
              </h2>
              {test.faults.map((f, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <p className="font-medium text-pretty">{f.what}</p>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                    {f.expected && (
                      <>
                        <dt className="text-muted-foreground">Expected</dt>
                        <dd className="text-pretty">{f.expected}</dd>
                      </>
                    )}
                    {f.saw && (
                      <>
                        <dt className="text-muted-foreground">The app</dt>
                        <dd className="min-w-0">
                          <Evidence text={f.saw} textClassName="text-pretty" />
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              ))}
            </section>
          )}

          <TestRunView
            key={run?.id}
            appUrl={app.url}
            startPath={test.startPath}
            lines={lines}
            cleanup={spec.cleanup.length > 0 ? { lines: viewLines("c", spec.cleanup, ranCleanup, url), open: Boolean(cleanupFailed), status: ranCleanup ? (cleanupFailed ? " · didn't finish" : " · done") : "" } : undefined}
            video={running ? null : url(result?.video)}
            poster={url(result?.steps.findLast((s) => s.screenshot)?.screenshot)}
            live={state.active && run?.id === latest?.id ? { frame: url(run?.liveFrame), queued: run?.status === "queued" } : undefined}
            stale={Boolean(result && !lined)}
            pick={wrong?.shot ? wrong.key : undefined}
          >
            {result && <SigningReviews reviews={result.signingReviews} />}
          </TestRunView>
        </>
      )}
    </div>
  );
}

const DOT: Record<TestRunRow["status"], string> = {
  passed: "bg-good-bar",
  failed: "bg-bad-mid",
  unverified: "bg-warn-bar",
  running: "bg-live animate-pulse motion-reduce:animate-none",
  queued: "border-2 border-live",
  stopped: "bg-foreground/15",
};

/** This test's results as a row of marks, oldest first. Each opens that result here. */
function Results({ here, runs, selected }: { here: string; runs: TestRunRow[]; selected?: string }) {
  return (
    <nav aria-label="Results" className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Last {runs.length} results</span>
      <ol className="flex items-center gap-1">
        {[...runs].reverse().map((r) => (
          <li key={r.id} className="flex">
            <Link
              href={r.id === runs[0]!.id ? here : `${here}?run=${r.id}`}
              aria-current={r.id === selected ? "true" : undefined}
              aria-label={`${STATE_LABEL[r.status]}, ${timeAgo(r.createdAt)}`}
              title={`${STATE_LABEL[r.status]} · ${TRIGGER_LABEL[r.trigger]} · ${timeAgo(r.createdAt)}`}
              className={cx("flex size-4 items-center justify-center rounded-[5px] outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring", r.id === selected && "ring-1 ring-foreground/40")}
            >
              <span className={cx("size-2.5 rounded-[3px]", DOT[r.status])} />
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
