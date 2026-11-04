import { analyses, db, flowsWithTests, latestRuns, type TestRow, type TestRunRow } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction } from "@/actions/apps";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddTest, NewFlow } from "@/components/tests/add-test";
import { AnalysisPanel } from "@/components/tests/analysis-panel";
import { FlowHeader } from "@/components/tests/flow-header";
import { RunButton } from "@/components/tests/run-button";
import { isActive, StateMark, stateOf, type TestState } from "@/components/tests/status";
import { cx } from "@/components/ui";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { requireApp } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

export default async function TestsHome({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const [[analysis], all] = await Promise.all([
    db().select().from(analyses).where(eq(analyses.appId, appId)).orderBy(desc(analyses.createdAt)).limit(1),
    flowsWithTests(db(), appId),
  ]);
  const tests = all.flatMap((f) => f.tests);
  const runs = await latestRuns(db(), tests.map((t) => t.id));
  const state = new Map(tests.map((t) => [t.id, stateOf(t, runs.get(t.id))]));
  const host = hostFromUrl(app.url);

  const exploring = analysis && (analysis.status === "queued" || analysis.status === "running");
  const anyActive = [...state.values()].some(isActive);
  const activeIds = tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
  const passing = tests.filter((t) => state.get(t.id) === "pass").length;
  const failing = tests.filter((t) => state.get(t.id) === "fail").length;
  const lastRun = [...runs.values()].map((r) => r.finishedAt).filter((d) => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="page flex flex-col gap-8">
      {(exploring || anyActive) && <AutoRefresh every={2000} />}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="h1 truncate">{app.name}</h1>
          <p className="m-0 flex flex-wrap items-center gap-x-2 font-mono text-[12px] text-muted">
            <a href={app.url} target="_blank" rel="noreferrer" className="text-muted">
              {host}
            </a>
            {tests.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{plural(tests.length, "test")}</span>
                {failing > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-bad">{failing} failing</span>
                  </>
                )}
                {passing > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{passing} passing</span>
                  </>
                )}
                {lastRun && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>last run {timeAgo(lastRun)}</span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
        {tests.length > 0 && <RunButton target={{ appId, all: true }} active={activeIds.length > 0} label="Run all" size="md" primary />}
      </header>

      {analysis && <AnalysisPanel analysis={analysis} appId={appId} host={host} hasFlows={all.length > 0} />}

      {all.map((f) => {
        const states = f.tests.map((t) => state.get(t.id)!);
        const flowActive = f.tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
        return (
          <section key={f.id} aria-label={f.name} className="card overflow-hidden">
            <FlowHeader appId={appId} flow={f} count={f.tests.length} summary={flowSummary(states)} activeIds={flowActive} />
            <ul className="m-0 list-none divide-y divide-divide p-0">
              {f.tests
                .filter((t) => !t.baseId)
                .map((t) => {
                  const children = f.tests.filter((c) => c.baseId === t.id);
                  return [
                    <TestLine key={t.id} appId={appId} test={t} state={state.get(t.id)!} run={runs.get(t.id)} />,
                    children.length > 0 && <UnhappyGroup key={`${t.id}-unhappy`} appId={appId} tests={children} state={state} runs={runs} />,
                  ];
                })}
            </ul>
            <div className="border-t border-divide">
              <AddTest appId={appId} flowId={f.id} flowName={f.name} />
            </div>
          </section>
        );
      })}

      {all.length > 0 ? (
        <NewFlow appId={appId} />
      ) : !exploring ? (
        <div className="flex flex-col gap-4">
          {!analysis && (
            <section className="card flex flex-wrap items-center justify-between gap-4 p-6">
              <div className="flex flex-col gap-1">
                <h2 className="h2">No tests yet</h2>
                <p className="m-0 text-[15px] text-ink-3">Let DappDrill explore {host} and write the first ones, or add a flow yourself.</p>
              </div>
              <form action={analyzeAction.bind(null, appId)}>
                <button type="submit" className="btn btn-primary">
                  Explore the app
                </button>
              </form>
            </section>
          )}
          <NewFlow appId={appId} first />
        </div>
      ) : null}
    </div>
  );
}

function flowSummary(states: TestState[]): string {
  if (states.some((s) => s === "running" || s === "queued")) return "running";
  const fail = states.filter((s) => s === "fail").length;
  if (fail) return `${fail} failing`;
  if (states.length && states.every((s) => s === "pass")) return "all passing";
  if (states.every((s) => s === "never" || s === "drafting")) return "not run yet";
  return `${states.filter((s) => s === "pass").length} passing`;
}

/** A test's unhappy paths: one quiet row, opened when one of them fails or is running. */
function UnhappyGroup({ appId, tests, state, runs }: { appId: string; tests: TestRow[]; state: Map<string, TestState>; runs: Map<string, TestRunRow> }) {
  const states = tests.map((t) => state.get(t.id)!);
  const open = states.some((s) => s === "fail" || s === "error" || isActive(s));
  const active = tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
  return (
    <li>
      <details open={open} className="group/unhappy">
        <summary className="flex cursor-pointer list-none items-center gap-3 py-2.5 pr-5 pl-5 hover:bg-sub">
          <span aria-hidden="true" className="ml-1.5 h-4 w-3 shrink-0 self-start border-b border-l border-line-strong" style={{ marginTop: -2 }} />
          <span className="flex flex-1 items-center gap-1.5 font-mono text-[12px] text-muted">
            {plural(tests.length, "unhappy path")} · {flowSummary(states)}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="transition-transform group-open/unhappy:rotate-90">
              <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </span>
          <span className="relative z-10">
            <RunButton target={{ appId, testIds: tests.map((t) => t.id) }} active={active.length > 0} stopIds={active} label="Run unhappy paths" />
          </span>
        </summary>
        <ul className="m-0 list-none divide-y divide-divide border-t border-divide p-0">
          {tests.map((t) => (
            <TestLine key={t.id} appId={appId} test={t} state={state.get(t.id)!} run={runs.get(t.id)} />
          ))}
        </ul>
      </details>
    </li>
  );
}

function TestLine({ appId, test, state, run }: { appId: string; test: TestRow; state: TestState; run?: TestRunRow }) {
  const unhappy = Boolean(test.baseId);
  const steps = run?.result?.steps ?? [];
  const current = steps.findIndex((s) => s.status === "running");
  let detail: React.ReactNode = null;
  if (state === "drafting") detail = <span className="text-muted">Writing the steps…</span>;
  else if (state === "running" && current >= 0) detail = <span className="text-live">Step {current + 1} of {steps.length}</span>;
  else if (state === "queued") detail = <span className="text-live">Queued</span>;
  else if ((state === "fail" || state === "error") && run?.result?.failure) detail = <span className={state === "fail" ? "text-bad" : "text-ink-3"}>{run.result.failure}</span>;

  return (
    <li className="group relative flex items-center gap-3 px-5 py-3 hover:bg-sub">
      {unhappy && <span aria-hidden="true" className="ml-1.5 h-4 w-3 shrink-0 self-start border-b border-l border-line-strong" style={{ marginTop: -2 }} />}
      <StateMark state={state} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={`/apps/${appId}/tests/${test.id}`} className={cx("truncate no-underline after:absolute after:inset-0", unhappy ? "text-[14.5px] text-ink-2" : "text-[15.5px] text-ink")}>
          {test.name}
        </Link>
        {detail && <span className="truncate text-[13px]">{detail}</span>}
      </div>
      <span className="hidden shrink-0 font-mono text-[11px] text-faint sm:inline">{run?.finishedAt && state !== "running" && state !== "queued" ? timeAgo(run.finishedAt) : ""}</span>
      <span className="relative z-10">
        <RunButton target={{ appId, testIds: [test.id] }} active={state === "running" || state === "queued"} stopIds={[test.id]} label="Run test" disabled={state === "drafting"} />
      </span>
    </li>
  );
}
