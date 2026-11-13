import { formatDuration, sentence, type LineResult, type TestResult } from "@dappdrill/core";
import { db, testOf, testRuns, tests, type TestRunRow } from "@dappdrill/db";
import { and, desc, eq } from "drizzle-orm";
import { Bug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTestAction } from "@/actions/tests";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { TestEditor } from "@/components/tests/lines-editor";
import { RunButton } from "@/components/tests/run-button";
import { Panel, SigningReviews } from "@/components/tests/run-details";
import { LINE_LABEL, LINE_STATE, readLabel, readTest, STATE_LABEL, STATE_TEXT, StateMark, type TestState } from "@/components/tests/status";
import { SigningFlag } from "@/components/tests/test-card";
import { cx } from "@/components/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";
import { timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Params = { appId: string; testId: string };
type Line = ReturnType<typeof testOf>["steps"][number];

async function load(appId: string, testId: string) {
  const { role } = await requireApp(appId);
  const [test] = await db()
    .select()
    .from(tests)
    .where(and(eq(tests.id, testId), eq(tests.appId, appId)));
  if (!test) notFound();
  return { test, role };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { appId, testId } = await params;
  return { title: (await load(appId, testId)).test.name };
}

const SETTLED = new Set<TestRunRow["status"]>(["passed", "failed", "unverified"]);

export default async function TestPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ run?: string }> }) {
  const { appId, testId } = await params;
  const { run: runParam } = await searchParams;
  const { test } = await load(appId, testId);
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

  return (
    <div className="page flex flex-col gap-8">
      {state.active && <AutoRefresh every={2000} />}

      <header className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href={`/apps/${appId}`} className="hover:text-foreground">
            Tests
          </Link>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-pretty">{test.name}</h1>
            <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1", STATE_TEXT[state.mark])}>
              <StateMark state={state.mark} />
              <span>{readLabel(state)}</span>
              {settled?.finishedAt && <span className="text-muted-foreground">· {timeAgo(settled.finishedAt)}</span>}
              {settled?.result && <span className="text-muted-foreground">· took {formatDuration(settled.result.durationMs)}</span>}
              <SigningFlag reviews={settled?.result?.signingReviews ?? []} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RunButton target={{ appId, testIds: [test.id] }} active={Boolean(state.active)} stopIds={[test.id]} label="Run" size="md" primary />
            <ConfirmButton className={buttonVariants({ variant: "outline", size: "sm" })} onConfirm={deleteTestAction.bind(null, test.id)}>
              Delete
            </ConfirmButton>
          </div>
        </div>
      </header>

      {viewingOld && run && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-5 py-3 text-muted-foreground">
          <span>
            Showing the result from {timeAgo(run.createdAt)} ({STATE_LABEL[run.status].toLowerCase()}).
          </span>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href={`/apps/${appId}/tests/${test.id}`}>Back to the latest</Link>
          </Button>
        </div>
      )}

      {result?.reason && run && (run.status === "failed" || run.status === "unverified") && (
        <div role="status" className={cx("flex flex-col gap-1 rounded-xl border px-5 py-4 leading-relaxed", run.status === "failed" ? "border-bad-line bg-bad-soft text-bad-ink" : "border-warn-line bg-warn-soft text-warn-ink")}>
          <p>{result.reason}</p>
          {result.rerun && <p className="text-sm opacity-80">It was run a second time before it counted{result.firstReason && result.firstReason !== result.reason ? `. The first time: ${result.firstReason}` : ", and went the same way."}</p>}
        </div>
      )}

      {test.faults.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Bug className="size-4" aria-hidden="true" />
            {state.settled === "passed" ? "This test was kept because it failed on a bug. It passes now." : "This test fails on a bug in the app"}
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
                    <dd className="text-pretty">{f.saw}</dd>
                  </>
                )}
              </dl>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <TestEditor
            testId={test.id}
            canEdit={!state.active}
            test={{ name: test.name, goal: test.goal, startPath: test.startPath, lines: spec.steps.map((l) => ({ type: l.type, text: sentence(l) })) }}
            view={
              <div className="flex flex-col gap-6">
                <Block label="Goal">{test.goal}</Block>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    Lines <span className="font-normal">· starts on {test.startPath}</span>
                  </span>
                  <Lines lines={spec.steps} results={lined} values={result?.values} running={run?.status === "running"} url={url} />
                  {result && !lined && <p className="text-sm text-muted-foreground">The test was edited after this result, so the lines don&apos;t show how each went. Run it again.</p>}
                </div>
                {spec.cleanup.length > 0 && <Cleanup lines={spec.cleanup} results={result?.cleanup} url={url} />}
              </div>
            }
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Media run={run} result={result} url={url} />
          {result && <SigningReviews reviews={result.signingReviews} />}
          {history.length > 1 && <History appId={appId} testId={test.id} runs={history} selected={run?.id} />}
        </aside>
      </div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <p className="leading-relaxed text-pretty">{children}</p>
    </div>
  );
}

/** A line's words with this run's values in place of their names, so the page reads as what was done. */
function filled(text: string, values?: Record<string, string>) {
  if (!values) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}

/** The lines of a test in order, each with how it went in the run on screen. */
function Lines({ lines, results, values, running, url }: { lines: Line[]; results?: LineResult[]; values?: Record<string, string>; running?: boolean; url: (p?: string | null) => string | null }) {
  // While a run is on, the first line with no result yet is the one being done.
  const at = running && results ? results.findIndex((r) => r.status === "skipped") : -1;
  return (
    <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {lines.map((line, i) => {
        const r = results?.[i];
        const state: TestState = i === at ? "running" : r ? LINE_STATE[r.status] : "never";
        const shot = url(r?.screenshot);
        const bad = r?.status === "fail" || r?.status === "unsure";
        return (
          <li key={i} className="flex gap-3 px-4 py-3">
            <StateMark state={state} label={i === at ? "Running" : r ? LINE_LABEL[r.status] : "No result"} className="mt-0.5" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-pretty">
                <span className="mr-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{line.type === "check" ? "Check" : "Do"}</span>
                {filled(sentence(line), values)}
              </p>
              {r?.note && (bad || line.type === "check") && <p className={cx("text-sm text-pretty", r.status === "fail" ? "text-bad" : r.status === "unsure" ? "text-warn" : "text-muted-foreground")}>{r.note}</p>}
              {r?.redone && <p className="text-sm text-pretty text-muted-foreground">The recorded actions stopped working, so it was worked out again: {r.redone}</p>}
              {r && r.did.length > 0 && bad && <p className="text-xs text-pretty text-muted-foreground">{r.did.join(" · ")}</p>}
            </div>
            {shot && (
              <a href={shot} target="_blank" rel="noreferrer" className="shrink-0 self-start overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot} alt={`The page at line ${i + 1}`} loading="lazy" className="block h-12 w-20 object-cover object-top" />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** What the test puts back afterwards. It never changes the result, so it's folded away unless it didn't finish. */
function Cleanup({ lines, results, url }: { lines: Line[]; results?: LineResult[]; url: (p?: string | null) => string | null }) {
  const ran = results && results.length === lines.length ? results : undefined;
  const failed = ran?.some((s) => s.status !== "pass");
  return (
    <details open={failed} className="flex flex-col gap-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <span>Cleanup</span>
        <span className="font-normal">· puts the account back after the result{ran ? (failed ? <> · <span className="text-warn">didn&apos;t finish</span></> : " · done") : ""}</span>
      </summary>
      <div className="mt-2">
        <Lines lines={lines} results={ran} url={url} />
      </div>
    </details>
  );
}

function Media({ run, result, url }: { run?: TestRunRow; result?: TestResult; url: (p?: string | null) => string | null }) {
  if (!run) return null;
  const running = run.status === "running";
  const last = result?.steps.findLast((s) => s.screenshot)?.screenshot;
  const frame = running ? url(run.liveFrame) : url(last);
  const video = !running ? url(result?.video) : null;
  if (!frame && !video)
    return running || run.status === "queued" ? (
      <div className="flex aspect-[16/10] items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-xs">{running ? "Opening the app…" : "Waiting for a browser…"}</div>
    ) : null;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      {video ? (
        <video src={video} poster={frame ?? undefined} controls muted playsInline className="block aspect-[16/10] w-full bg-muted object-contain" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame!} alt={running ? "The test running now" : "The page when the test finished"} className="block aspect-[16/10] w-full bg-muted object-cover object-top" />
      )}
      {running && (
        <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-live">
          <span className="size-1.5 animate-pulse rounded-full bg-live" /> Live
        </div>
      )}
    </div>
  );
}

/** Every result of this test, newest first. Each belongs to a run (a batch), which the Runs page lists. */
function History({ appId, testId, runs, selected }: { appId: string; testId: string; runs: TestRunRow[]; selected?: string }) {
  return (
    <Panel title="Results" count={runs.length}>
      <ul className="divide-y">
        {runs.map((r, i) => (
          <li key={r.id}>
            <Link
              href={i === 0 ? `/apps/${appId}/tests/${testId}` : `/apps/${appId}/tests/${testId}?run=${r.id}`}
              aria-current={r.id === selected ? "true" : undefined}
              className={cx("flex items-center gap-3 px-4 py-2 hover:bg-accent/50", r.id === selected && "bg-accent")}
            >
              <StateMark state={r.status} />
              <span className={cx("flex-1", STATE_TEXT[r.status])}>{STATE_LABEL[r.status]}</span>
              <span className="text-xs text-muted-foreground">{TRIGGER_LABEL[r.trigger]}</span>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
