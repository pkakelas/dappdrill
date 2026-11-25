import { formatDuration, fundText, sentence, type LineResult } from "@dappdrill/core";
import { accountOf, db, isRepair, makes, testOf, testRuns, tests, type TestRunRow } from "@dappdrill/db";
import { and, desc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { TestEditor } from "@/components/tests/lines-editor";
import { RepairButton } from "@/components/tests/repair-button";
import { SigningReviews } from "@/components/tests/run-details";
import { LINE_LABEL, LINE_STATE, readLabel, readTest, STATE_LABEL, shortReason } from "@/components/tests/status";
import { TestActions } from "@/components/tests/test-actions";
import { TestRunView, type Around, type ViewLine } from "@/components/tests/test-run-view";
import { Results, StatusNote, TestStatus, type StatusWord } from "@/components/tests/test-status";
import { cx } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";
import { timeAgo } from "@/lib/format";
import { isCode, unwritten } from "@/lib/lines";
import { requireApp } from "@/lib/session";
import { startChoices } from "@/lib/starts";

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

/** The reset or the cleanup as the run on screen left it: folded unless a line of it didn't pass. */
function around(prefix: string, lines: Line[], results: LineResult[] | undefined, url: (p?: string | null) => string | null): Around | undefined {
  if (lines.length === 0) return undefined;
  // Lines edited since the run no longer line up with its results. Nothing is there when they didn't have to be done.
  const ran = results && results.length === lines.length ? results : undefined;
  const failed = Boolean(ran?.some((s) => s.status !== "pass"));
  return {
    lines: viewLines(prefix, lines, ran, url),
    open: failed,
    status: ran ? (failed ? " · didn't finish" : " · done") : "",
  };
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
      notCode: !isCode(line),
    };
  });
}

export default async function TestPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ run?: string; edit?: string }> }) {
  const { appId, testId } = await params;
  const { run: runParam, edit } = await searchParams;
  const { test, app } = await load(appId, testId);
  const [history, [repair]] = await Promise.all([
    db().select().from(testRuns).where(eq(testRuns.testId, test.id)).orderBy(desc(testRuns.createdAt)).limit(15),
    db()
      .select()
      .from(makes)
      .where(and(eq(makes.appId, appId), isRepair))
      .orderBy(desc(makes.createdAt))
      .limit(1),
  ]);

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
  // On new accounts a test may say what its own starts with, in place of what the app sends every one.
  const starts = startChoices(app);

  const running = run?.status === "running";
  const lines = viewLines("l", spec.steps, lined, url, result?.values, running);
  // A run can't do the test as it is: its last one stopped for want of code, or a line was added or reworded since.
  const needsRepair = Boolean(settled?.result?.repairable) || unwritten(spec);
  const inRepair = repair?.state.repair?.tests.find((t) => t.testId === test.id);
  const repairing = Boolean(inRepair && (repair?.status === "queued" || repair?.status === "running"));
  // Why the last repair left it, unless the test was edited after that repair.
  const notRepaired = !repairing && inRepair?.status === "not-repaired" && repair?.finishedAt && repair.finishedAt > test.updatedAt ? inRepair.why : undefined;
  const wrong = lines.find((l) => l.state === "failed" || l.state === "unverified");
  // A failure counts once a second run goes the same way; when the first went another way, that is worth a line.
  const firstOther = result?.rerun && result.firstReason && result.firstReason !== result.reason ? shortReason(result.firstReason, true) : undefined;

  const lower = (r: TestRunRow) => STATE_LABEL[r.status].toLowerCase();

  // How it stands in a word, the way the app's list says it: what stops a run first, then the bug, then the last result.
  const step = wrong && run?.id === settled?.id ? ` at step ${lines.indexOf(wrong) + 1}` : "";
  const word: StatusWord = state.active
    ? { label: readLabel(state), mark: state.mark }
    : repairing
      ? { label: "Being repaired", mark: "running" }
      : needsRepair
        ? { label: "Needs repair", mark: "repair" }
        : state.settled === "failed" && test.faults.length > 0
          ? { label: "Bug found", mark: "failed" }
          : { label: `${readLabel(state)}${step}`, mark: state.mark };
  const inRepairs = word.mark === "repair" || repairing;
  const meta = settled?.finishedAt && (
    <>
      {inRepairs && !settled.result?.repairable && `last result ${lower(settled)} `}
      {timeAgo(settled.finishedAt)}
      {!inRepairs && settled.result && ` · took ${formatDuration(settled.result.durationMs)}`}
    </>
  );

  return (
    <div className="page flex flex-col gap-8">
      {state.active && <AutoRefresh every={2000} />}

      <header className="flex flex-col gap-5">
        <Link href={`/apps/${appId}`} className="-ml-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Tests
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-pretty">{test.name}</h1>
            <p className="max-w-3xl text-pretty text-muted-foreground">{test.goal}</p>
            {starts && spec.fund && <p className="text-sm text-muted-foreground">Its account starts with {spec.fund.length ? spec.fund.map(fundText).join(" and ") : "nothing"}.</p>}
          </div>
          <TestActions appId={appId} testId={test.id} active={Boolean(state.active)} />
        </div>
      </header>

      {editing ? (
        <TestEditor
          testId={test.id}
          back={here}
          test={{
            name: test.name,
            goal: test.goal,
            startPath: test.startPath,
            lines: spec.steps.map((l) => ({ type: l.type, text: sentence(l) })),
            fund: spec.fund ? spec.fund.map((f) => ({ chainId: f.chainId, token: f.token ?? "", amount: f.amount })) : null,
          }}
          starts={starts}
        />
      ) : (
        <>
          <TestStatus word={word} meta={meta} results={history.length > 1 && <Results here={here} runs={history} selected={run?.id} />}>
            {inRepairs && !viewingOld && (
              <StatusNote
                action={
                  repairing ? (
                    <Link
                      href={`/apps/${appId}`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      Watch the repair
                    </Link>
                  ) : (
                    <RepairButton appId={appId} testIds={[test.id]} />
                  )
                }
              >
                <p className="text-muted-foreground">
                  {repairing
                    ? "We're doing its steps in the browser and recording them again. It is run once afterwards."
                    : settled?.result?.repairable
                      ? "A recorded step no longer fits the page, so a run stops there. A repair does the test in the browser, records that step again, and runs the test once."
                      : "A step was added or reworded, so a run stops there. A repair does the test in the browser, records the step, and runs the test once."}
                </p>
                {notRepaired && <p>The last repair couldn&apos;t fix it: {notRepaired}</p>}
              </StatusNote>
            )}

            {/* A reason that is a step's is said by that step, below. Only one that isn't (blocked, a dangerous signature, a page error) gets said here. */}
            {result?.reason && run && !wrong && (run.status === "unverified" || (run.status === "failed" && !onBug)) && (
              <StatusNote title={run.status === "failed" ? "Why it failed" : "Why it couldn't be verified"} tone={run.status === "failed" ? "bad" : "warn"}>
                <p className="[overflow-wrap:anywhere]">{result.reason}</p>
              </StatusNote>
            )}

            {/* A failure on the bug the test was kept for is said once, as that bug. */}
            {test.faults.length > 0 && (
              <StatusNote title={word.label === "Bug found" ? undefined : state.settled === "passed" ? "Kept for a bug it found. It passes now." : "The bug this test was kept for"}>
                {test.faults.map((f, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <p className={cx("text-pretty", word.label === "Bug found" ? "text-base font-medium" : "text-muted-foreground")}>{f.what}</p>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                      {f.expected && (
                        <>
                          <dt className="text-muted-foreground">Expected</dt>
                          <dd className="text-pretty">{f.expected}</dd>
                        </>
                      )}
                      {f.saw && (
                        <>
                          <dt className="text-muted-foreground">The app</dt>
                          <dd className="min-w-0 text-pretty [overflow-wrap:anywhere]">{f.saw}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                ))}
              </StatusNote>
            )}

            {firstOther && (
              <StatusNote>
                <p className="text-muted-foreground">It was run twice before it counted. The first time: {firstOther}.</p>
              </StatusNote>
            )}

            {viewingOld && run && (
              <StatusNote
                action={
                  <Link
                    href={here}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Back to the latest
                  </Link>
                }
              >
                <p className="text-muted-foreground">
                  Showing the result from {timeAgo(run.createdAt)} below: {lower(run)}.
                </p>
              </StatusNote>
            )}
          </TestStatus>

          <TestRunView
            key={run?.id}
            appUrl={app.url}
            startPath={test.startPath}
            lines={lines}
            reset={accountOf(app) === "kept" ? around("r", app.suite.reset?.steps ?? [], result?.reset, url) : undefined}
            cleanup={around("c", spec.cleanup, result?.cleanup, url)}
            video={running ? null : url(result?.video)}
            poster={url(result?.steps.findLast((s) => s.screenshot)?.screenshot)}
            live={
              state.active && run?.id === latest?.id
                ? {
                    frame: url(run?.liveFrame),
                    queued: run?.status === "queued",
                  }
                : undefined
            }
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
