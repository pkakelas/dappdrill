import { conditionInfo, formatDuration, type TestRunResult, type TestStep } from "@dappdrill/core";
import { db, flows, latestRuns, testRuns, tests, type TestRunRow } from "@dappdrill/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTestAction } from "@/actions/tests";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { Fork } from "@/components/tests/fork";
import { RunButton } from "@/components/tests/run-button";
import { ConsoleErrors, IssueList, Panel, WalletActivity } from "@/components/tests/run-details";
import { SpecEditor } from "@/components/tests/spec-editor";
import { isActive, STATE_LABEL, STATE_TEXT, StateMark, stateOf } from "@/components/tests/status";
import { AddUnhappy } from "@/components/tests/unhappy";
import { cx } from "@/components/ui";
import { artifactUrl } from "@/lib/artifacts";
import { timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Params = { appId: string; testId: string };

async function load(appId: string, testId: string) {
  await requireApp(appId);
  const [test] = await db().select().from(tests).where(and(eq(tests.id, testId), eq(tests.appId, appId)));
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
  const [[flow], [base], children, history, [forkedFrom]] = await Promise.all([
    db().select().from(flows).where(eq(flows.id, test.flowId)),
    test.baseId ? db().select().from(tests).where(eq(tests.id, test.baseId)) : Promise.resolve([]),
    test.baseId ? Promise.resolve([]) : db().select().from(tests).where(eq(tests.baseId, test.id)).orderBy(asc(tests.position)),
    db().select().from(testRuns).where(eq(testRuns.testId, test.id)).orderBy(desc(testRuns.createdAt)).limit(15),
    test.forkedFrom ? db().select({ id: tests.id, name: tests.name }).from(tests).where(eq(tests.id, test.forkedFrom)) : Promise.resolve([]),
  ]);
  const childRuns = await latestRuns(db(), children.map((c) => c.id));

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
        <nav aria-label="Breadcrumb" className="crumbs flex flex-wrap items-center gap-1.5">
          <Link href={`/apps/${appId}`}>Tests</Link>
          <span aria-hidden="true">/</span>
          <span>{flow?.name}</span>
          {base && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/apps/${appId}/tests/${base.id}`}>{base.name}</Link>
            </>
          )}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="h1 text-[30px] sm:text-[38px]">{test.name}</h1>
            <p className={cx("m-0 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px]", STATE_TEXT[state])}>
              <StateMark state={state} />
              <span>{STATE_LABEL[state]}</span>
              {latest?.finishedAt && state !== "running" && state !== "queued" && <span className="text-muted">· {timeAgo(latest.finishedAt)}</span>}
              {latest?.startedAt && latest.finishedAt && <span className="text-muted">· took {formatDuration(latest.finishedAt.getTime() - latest.startedAt.getTime())}</span>}
              {forkedFrom && (
                <span className="text-muted">
                  · forked from <Link href={`/apps/${appId}/tests/${forkedFrom.id}`}>{forkedFrom.name}</Link>
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RunButton target={{ appId, testIds: [test.id] }} active={state === "running" || state === "queued"} stopIds={[test.id]} label="Run" size="md" primary disabled={state === "drafting"} />
            {!test.baseId && state !== "drafting" && <Fork testId={test.id} />}
            <ConfirmButton className="btn btn-sm" onConfirm={deleteTestAction.bind(null, test.id)}>
              Delete
            </ConfirmButton>
          </div>
        </div>
      </header>

      {test.drafting && (
        <div className="card flex items-center gap-3 border-dashed px-5 py-4">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-quiet" />
          <p className="m-0 text-[15px] text-ink-3">
            Writing this test from “{test.drafting}”. It runs as soon as the steps are ready.
          </p>
        </div>
      )}

      {viewingOld && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sub px-5 py-3 text-[14px] text-ink-3">
          <span>
            Showing the run from {timeAgo(run.createdAt)} ({STATE_LABEL[run.status].toLowerCase()}).
          </span>
          <Link href={`/apps/${appId}/tests/${test.id}`} className="btn-link">
            Back to the latest
          </Link>
        </div>
      )}

      {result?.failure && (runState === "fail" || runState === "error") && (
        <div role="status" className={cx("rounded-xl border px-5 py-4 text-[15px] leading-relaxed", runState === "fail" ? "border-bad-line bg-bad-soft text-bad-ink" : "border-line bg-sub text-ink-2")}>
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
                  <p className="m-0 rounded-xl bg-sub px-4 py-3 text-[14px] text-ink-3">
                    Runs the steps of <Link href={`/apps/${appId}/tests/${base.id}`}>{base.name}</Link> with this condition: <strong className="font-semibold text-ink">{condition.name}</strong>.
                  </p>
                )}
                <Block label="Goal">{test.goal || <span className="text-faint">Not written yet</span>}</Block>
                <Block label="Expected result">
                  {test.expected || <span className="text-faint">Not written yet</span>}
                  {result?.verdict && (
                    <span className={cx("mt-2 flex gap-2 text-[13.5px]", result.verdict.ok ? "text-muted" : "text-bad")}>
                      <span aria-hidden="true">{result.verdict.ok ? "✓" : "✗"}</span>
                      <span>{result.verdict.reason}</span>
                    </span>
                  )}
                </Block>
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
                <ul className="m-0 list-none divide-y divide-divide border-b border-divide p-0">
                  {children.map((c) => {
                    const s = stateOf(c, childRuns.get(c.id));
                    return (
                      <li key={c.id}>
                        <Link href={`/apps/${appId}/tests/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 no-underline hover:bg-sub">
                          <StateMark state={s} />
                          <span className="min-w-0 flex-1 truncate text-[14.5px]">{c.name}</span>
                          <span className={cx("font-mono text-[11px]", STATE_TEXT[s])}>{STATE_LABEL[s]}</span>
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
      <span className="label">{label}</span>
      <p className="m-0 flex flex-col text-[16px] leading-relaxed">{children}</p>
    </div>
  );
}

function Steps({ steps, result, url }: { steps: TestStep[]; result?: TestRunResult; url: (p?: string | null) => string | null }) {
  if (steps.length === 0)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="label">Steps</span>
        <p className="m-0 text-[15px] text-faint">No steps yet. The first run works them out from the goal.</p>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <span className="label">Steps</span>
      <ol className="card m-0 list-none divide-y divide-divide p-0">
        {steps.map((s, i) => {
          const r = result?.steps[i];
          const shot = url(r?.screenshot);
          return (
            <li key={i} className={cx("flex gap-3 px-4 py-3", r?.status === "fail" && "bg-bad-soft")}>
              <span className="flex w-5 shrink-0 justify-center pt-[3px]">
                {r && r.status !== "pending" ? <StateMark state={r.status === "skipped" ? "skipped" : r.status} /> : <span className="font-mono text-[12px] text-faint">{i + 1}</span>}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={cx("text-[15.5px] leading-snug", r?.status === "skipped" && "text-faint")}>{s.text}</span>
                {r?.note && <span className={cx("text-[13px] leading-snug", r.status === "fail" ? "text-bad" : "text-ink-3")}>{r.note}</span>}
                {r && r.did.length > 0 && <span className="text-[12.5px] leading-snug text-muted">{r.did.join(" · ")}</span>}
              </div>
              {shot && (
                <a href={shot} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`Screenshot after step ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shot} alt="" className="h-12 w-20 rounded-md border border-line object-cover object-top" />
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Media({ run, result, url }: { run?: TestRunRow; result?: TestRunResult; url: (p?: string | null) => string | null }) {
  if (!run) return null;
  const running = run.status === "running";
  const frame = running ? url(run.liveFrame) : url(result?.finalScreenshot);
  const video = !running ? url(result?.video) : null;
  if (!frame && !video)
    return running || run.status === "queued" ? (
      <div className="card flex aspect-[16/10] items-center justify-center font-mono text-[12px] text-muted">{running ? "Opening the app…" : "Waiting for a browser…"}</div>
    ) : null;
  return (
    <div className="card overflow-hidden">
      {video ? (
        <video src={video} poster={frame ?? undefined} controls muted playsInline className="block aspect-[16/10] w-full bg-sub object-contain" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame!} alt={running ? "The test running now" : "The page when the test finished"} className="block aspect-[16/10] w-full bg-sub object-cover object-top" />
      )}
      {running && (
        <div className="flex items-center gap-2 border-t border-divide px-4 py-2 font-mono text-[11px] text-live">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" /> Live
        </div>
      )}
    </div>
  );
}

function History({ appId, testId, runs, selected }: { appId: string; testId: string; runs: TestRunRow[]; selected?: string }) {
  return (
    <Panel title="Runs" count={runs.length}>
      <ul className="m-0 list-none divide-y divide-divide p-0">
        {runs.map((r, i) => (
          <li key={r.id}>
            <Link
              href={i === 0 ? `/apps/${appId}/tests/${testId}` : `/apps/${appId}/tests/${testId}?run=${r.id}`}
              aria-current={r.id === selected ? "true" : undefined}
              className={cx("flex items-center gap-3 px-4 py-2 no-underline hover:bg-sub", r.id === selected && "bg-sub")}
            >
              <StateMark state={r.status} />
              <span className={cx("flex-1 text-[14px]", STATE_TEXT[r.status])}>{STATE_LABEL[r.status]}</span>
              <span className="font-mono text-[11px] text-muted">{TRIGGER_LABEL[r.trigger]}</span>
              <span className="w-[86px] text-right font-mono text-[11px] text-faint">{timeAgo(r.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
