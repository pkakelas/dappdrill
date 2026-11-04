import { conditionInfo, formatDuration, SETUP_WHEN_LABEL, type AppSetup, type SetupRunResult, type TestRunResult, type TestStep } from "@dappdrill/core";
import { db, flows, latestRuns, testRuns, tests, type TestRunRow } from "@dappdrill/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTestAction } from "@/actions/tests";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { Fork } from "@/components/tests/fork";
import { RunButton } from "@/components/tests/run-button";
import { ConsoleErrors, IssueList, Panel, WalletActivity } from "@/components/tests/run-details";
import { StepList } from "@/components/tests/setup-steps";
import { SpecEditor } from "@/components/tests/spec-editor";
import { isActive, STATE_LABEL, STATE_TEXT, StateMark, stateOf } from "@/components/tests/status";
import { AddUnhappy } from "@/components/tests/unhappy";
import { cx } from "@/components/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";
import { timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Params = { appId: string; testId: string };

async function load(appId: string, testId: string) {
  await requireApp(appId);
  const [test] = await db()
    .select()
    .from(tests)
    .where(and(eq(tests.id, testId), eq(tests.appId, appId)));
  if (!test) notFound();
  return test;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { appId, testId } = await params;
  return { title: (await load(appId, testId)).name };
}

export default async function TestPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ run?: string }> }) {
  const { appId, testId } = await params;
  const { run: runParam } = await searchParams;
  const test = await load(appId, testId);
  const { app } = await requireApp(appId);
  const [[flow], [base], children, history, [forkedFrom]] = await Promise.all([
    db().select().from(flows).where(eq(flows.id, test.flowId)),
    test.baseId ? db().select().from(tests).where(eq(tests.id, test.baseId)) : Promise.resolve([]),
    test.baseId ? Promise.resolve([]) : db().select().from(tests).where(eq(tests.baseId, test.id)).orderBy(asc(tests.position)),
    db().select().from(testRuns).where(eq(testRuns.testId, test.id)).orderBy(desc(testRuns.createdAt)).limit(15),
    test.forkedFrom ? db().select({ id: tests.id, name: tests.name }).from(tests).where(eq(tests.id, test.forkedFrom)) : Promise.resolve([]),
  ]);
  const childRuns = await latestRuns(
    db(),
    children.map((c) => c.id),
  );

  const latest = history[0];
  const run = (runParam && history.find((r) => r.id === runParam)) || latest;
  const viewingOld = run && latest && run.id !== latest.id;
  const state = stateOf(test, latest);
  const runState = run ? run.status : "never";
  const result = run?.result ?? undefined;
  const steps: TestStep[] = base ? base.steps : test.steps;
  const childActive = children.some((c) => isActive(stateOf(c, childRuns.get(c.id))));
  const condition = test.condition ? conditionInfo(test.condition) : undefined;
  const url = (path?: string | null) => (run ? artifactUrl("runs", run.batchId, path) : null);

  return (
    <div className="page flex flex-col gap-8">
      {(isActive(state) || childActive) && <AutoRefresh every={2000} />}

      <header className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href={`/apps/${appId}`} className="hover:text-foreground">
            Tests
          </Link>
          <span aria-hidden="true">/</span>
          <span>{flow?.name}</span>
          {base && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/apps/${appId}/tests/${base.id}`} className="hover:text-foreground">
                {base.name}
              </Link>
            </>
          )}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{test.name}</h1>
            <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1", STATE_TEXT[state])}>
              <StateMark state={state} />
              <span>{STATE_LABEL[state]}</span>
              {latest?.finishedAt && state !== "running" && state !== "queued" && <span className="text-muted-foreground">· {timeAgo(latest.finishedAt)}</span>}
              {latest?.startedAt && latest.finishedAt && <span className="text-muted-foreground">· took {formatDuration(latest.finishedAt.getTime() - latest.startedAt.getTime())}</span>}
              {forkedFrom && (
                <span className="text-muted-foreground">
                  · forked from{" "}
                  <Link href={`/apps/${appId}/tests/${forkedFrom.id}`} className="underline underline-offset-4 hover:text-foreground">
                    {forkedFrom.name}
                  </Link>
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RunButton target={{ appId, testIds: [test.id] }} active={state === "running" || state === "queued"} stopIds={[test.id]} label="Run" size="md" primary disabled={state === "drafting"} />
            {!test.baseId && state !== "drafting" && <Fork testId={test.id} />}
            <ConfirmButton className={buttonVariants({ variant: "outline", size: "sm" })} onConfirm={deleteTestAction.bind(null, test.id)}>
              Delete
            </ConfirmButton>
          </div>
        </div>
      </header>

      {test.drafting && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card px-5 py-4">
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/50" />
          <p className="text-muted-foreground">Writing this test from “{test.drafting}”. It runs as soon as the steps are ready.</p>
        </div>
      )}

      {viewingOld && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-5 py-3 text-muted-foreground">
          <span>
            Showing the run from {timeAgo(run.createdAt)} ({STATE_LABEL[run.status].toLowerCase()}).
          </span>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href={`/apps/${appId}/tests/${test.id}`}>Back to the latest</Link>
          </Button>
        </div>
      )}

      {result?.failure && (runState === "fail" || runState === "error") && (
        <div
          role="status"
          className={cx("rounded-xl border px-5 py-4 leading-relaxed", runState === "fail" ? "border-bad-line bg-bad-soft text-bad-ink" : "border-warn-line bg-warn-soft text-warn-ink")}
        >
          {result.failure}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <SpecEditor
            testId={test.id}
            spec={{ name: test.name, goal: test.goal, expected: test.expected, steps: test.steps.map((s) => s.text) }}
            stepsFixed={Boolean(test.baseId)}
            disabled={Boolean(test.drafting)}
            view={
              <div className="flex flex-col gap-6">
                {condition && base && (
                  <p className="rounded-xl bg-muted px-4 py-3 text-muted-foreground">
                    Runs the steps of{" "}
                    <Link href={`/apps/${appId}/tests/${base.id}`} className="underline underline-offset-4 hover:text-foreground">
                      {base.name}
                    </Link>{" "}
                    with this condition: <strong className="font-semibold text-foreground">{condition.name}</strong>.
                  </p>
                )}
                <Block label="Goal">{test.goal || <span className="text-muted-foreground">Not written yet</span>}</Block>
                <Block label="Expected result">
                  {test.expected || <span className="text-muted-foreground">Not written yet</span>}
                  {result?.verdict && (
                    <span className={cx("mt-2 flex gap-2", result.verdict.ok ? "text-muted-foreground" : "text-bad")}>
                      {result.verdict.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                      <span>{result.verdict.reason}</span>
                    </span>
                  )}
                </Block>
                {result?.setup && <SetupRun appId={appId} run={result.setup} setup={app.setup} url={url} />}
                <Steps steps={steps} result={result} url={url} />
              </div>
            }
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Media run={run} result={result} url={url} />
          {result && <IssueList result={result} />}
          {result && <WalletActivity result={result} />}
          {result && <ConsoleErrors result={result} />}

          {!test.baseId && (
            <Panel title="Unhappy paths" count={children.length || undefined}>
              {children.length > 0 && (
                <ul className="divide-y border-b">
                  {children.map((c) => {
                    const s = stateOf(c, childRuns.get(c.id));
                    return (
                      <li key={c.id}>
                        <Link href={`/apps/${appId}/tests/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
                          <StateMark state={s} />
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <span className={cx("text-xs", STATE_TEXT[s])}>{STATE_LABEL[s]}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <AddUnhappy testId={test.id} existing={children.flatMap((c) => (c.condition ? [c.condition] : []))} />
            </Panel>
          )}

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
      <p className="flex flex-col leading-relaxed">{children}</p>
    </div>
  );
}

function Steps({ steps, result, url }: { steps: TestStep[]; result?: TestRunResult; url: (p?: string | null) => string | null }) {
  if (steps.length === 0)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">Steps</span>
        <p className="text-muted-foreground">No steps yet. The first run works them out from the goal.</p>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted-foreground">Steps</span>
      <StepList className="overflow-hidden rounded-xl border bg-card shadow-xs" steps={steps.map((s, i) => ({ text: s.text, result: result?.steps[i], shot: url(result?.steps[i]?.screenshot) }))} />
    </div>
  );
}

/** What the app's setup did before this run: folded away unless it's why the test couldn't run. */
function SetupRun({ appId, run, setup, url }: { appId: string; run: SetupRunResult; setup: AppSetup | null; url: (p?: string | null) => string | null }) {
  // Steps edited since the run no longer line up with its results.
  const texts = setup && setup.steps.length === run.steps.length ? setup.steps.map((s) => s.text) : run.steps.map((_, i) => `Step ${i + 1}`);
  const notes = [
    run.reused && "ran before an earlier test of this run; this test started from where it left off",
    run.shared && "on a live chain this test also started from what earlier tests left",
  ].filter(Boolean);
  return (
    <details open={!run.ok} className="group/setup flex flex-col gap-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <StateMark state={run.ok ? "pass" : run.steps.some((s) => s.status === "running") ? "running" : "error"} />
        <span>Setup</span>
        <span className="font-normal">
          · {SETUP_WHEN_LABEL[run.when].toLowerCase()} · {run.ok ? "passed" : run.steps.some((s) => s.status === "running") ? "running" : <span className="text-warn">didn't finish</span>}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {notes.length > 0 && <p className="text-sm text-muted-foreground">It {notes.join("; ")}.</p>}
        <StepList className="overflow-hidden rounded-xl border bg-card shadow-xs" steps={texts.map((text, i) => ({ text, result: run.steps[i], shot: url(run.steps[i]?.screenshot) }))} />
        <Link href={`/apps/${appId}`} className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Edit the setup
        </Link>
      </div>
    </details>
  );
}

function Media({ run, result, url }: { run?: TestRunRow; result?: TestRunResult; url: (p?: string | null) => string | null }) {
  if (!run) return null;
  const running = run.status === "running";
  const frame = running ? url(run.liveFrame) : url(result?.finalScreenshot);
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

function History({ appId, testId, runs, selected }: { appId: string; testId: string; runs: TestRunRow[]; selected?: string }) {
  return (
    <Panel title="Runs" count={runs.length}>
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
