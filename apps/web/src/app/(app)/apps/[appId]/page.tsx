import { analyses, db, flowsWithTests, latestRuns, type TestRow, type TestRunRow } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction } from "@/actions/apps";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddTest, NewFlow } from "@/components/tests/add-test";
import { AnalysisPanel } from "@/components/tests/analysis-panel";
import { FlowHeader } from "@/components/tests/flow-header";
import { RunButton } from "@/components/tests/run-button";
import { SetupCard } from "@/components/tests/setup-card";
import { isActive, StateMark, stateOf, type TestState } from "@/components/tests/status";
import { cx, ListItem, PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { ItemActions, ItemContent, ItemGroup, ItemMedia } from "@/components/ui/item";
import { artifactUrl } from "@/lib/artifacts";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { requireApp } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

export default async function TestsHome({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const [[analysis], all] = await Promise.all([db().select().from(analyses).where(eq(analyses.appId, appId)).orderBy(desc(analyses.createdAt)).limit(1), flowsWithTests(db(), appId)]);
  const tests = all.flatMap((f) => f.tests);
  const runs = await latestRuns(
    db(),
    tests.map((t) => t.id),
  );
  const state = new Map(tests.map((t) => [t.id, stateOf(t, runs.get(t.id))]));
  const host = hostFromUrl(app.url);

  const exploring = analysis && (analysis.status === "queued" || analysis.status === "running");
  const anyActive = [...state.values()].some(isActive);
  const activeIds = tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
  const passing = tests.filter((t) => state.get(t.id) === "pass").length;
  const failing = tests.filter((t) => state.get(t.id) === "fail").length;
  const lastRun = [...runs.values()]
    .map((r) => r.finishedAt)
    .filter((d) => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="page">
      {(exploring || anyActive) && <AutoRefresh every={2000} />}

      <PageHeader
        title={app.name}
        description={
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <a href={app.url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
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
        }
        actions={tests.length > 0 && <RunButton target={{ appId, all: true }} active={activeIds.length > 0} label="Run all" size="md" primary />}
      />

      <div className="flex flex-col gap-6">
        {analysis && <AnalysisPanel analysis={analysis} appId={appId} host={host} hasFlows={all.length > 0} />}

        {(app.setup || all.length > 0) && (
          <SetupCard appId={appId} setup={app.setup && { startPath: app.setup.startPath, steps: app.setup.steps.map((s) => s.text), when: app.setup.when, why: app.setup.why }} last={app.setup ? lastSetup(app.setup.steps.map((s) => s.text), [...runs.values()]) : undefined} />
        )}

        {all.map((f) => {
          const states = f.tests.map((t) => state.get(t.id)!);
          const flowActive = f.tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
          return (
            <section key={f.id} aria-label={f.name} className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <FlowHeader appId={appId} flow={f} count={f.tests.length} summary={flowSummary(states)} activeIds={flowActive} />
              <ItemGroup className="divide-y">
                {f.tests
                  .filter((t) => !t.baseId)
                  .map((t) => {
                    const children = f.tests.filter((c) => c.baseId === t.id);
                    return [
                      <TestLine key={t.id} appId={appId} test={t} state={state.get(t.id)!} run={runs.get(t.id)} />,
                      children.length > 0 && <UnhappyGroup key={`${t.id}-unhappy`} appId={appId} tests={children} state={state} runs={runs} />,
                    ];
                  })}
              </ItemGroup>
              <div className="border-t">
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
              <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-6 shadow-xs">
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold">No tests yet</h2>
                  <p className="text-sm text-muted-foreground">Let DappDrill explore {host} and write the first ones, or add a flow yourself.</p>
                </div>
                <form action={analyzeAction.bind(null, appId)}>
                  <Button type="submit">Explore the app</Button>
                </form>
              </section>
            )}
            <NewFlow appId={appId} first />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The setup as it last ran (the run that did it, not one that started from its state). Steps edited since show without results. */
function lastSetup(texts: string[], runs: TestRunRow[]) {
  const run = runs.filter((r) => r.result?.setup && !r.result.setup.reused).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const setup = run?.result?.setup;
  if (!run || !setup || setup.steps.length !== texts.length) return undefined;
  const running = setup.steps.some((s) => s.status === "running" || s.status === "pending");
  const label = running ? (
    <span className="text-live">running now</span>
  ) : setup.ok ? (
    `passed ${run.finishedAt ? timeAgo(run.finishedAt) : ""}`.trim()
  ) : (
    <span className="text-warn">didn't finish {run.finishedAt ? timeAgo(run.finishedAt) : ""}</span>
  );
  return { label, ok: setup.ok && !running, steps: texts.map((text, i) => ({ text, result: setup.steps[i], shot: artifactUrl("runs", run.batchId, setup.steps[i]?.screenshot) })) };
}

function flowSummary(states: TestState[]): string {
  if (states.some((s) => s === "running" || s === "queued")) return "running";
  const fail = states.filter((s) => s === "fail").length;
  if (fail) return `${fail} failing`;
  if (states.length && states.every((s) => s === "pass")) return "all passing";
  if (states.every((s) => s === "never" || s === "drafting")) return "not run yet";
  return `${states.filter((s) => s === "pass").length} passing`;
}

const branch = <span aria-hidden="true" className="-mt-0.5 ml-1.5 h-4 w-3 shrink-0 self-start border-b border-l border-muted-foreground/30" />;

/** A test's unhappy paths: one quiet row, opened when one of them fails or is running. */
function UnhappyGroup({ appId, tests, state, runs }: { appId: string; tests: TestRow[]; state: Map<string, TestState>; runs: Map<string, TestRunRow> }) {
  const states = tests.map((t) => state.get(t.id)!);
  const open = states.some((s) => s === "fail" || s === "error" || isActive(s));
  const active = tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
  return (
    <div role="listitem">
      <details open={open} className="group/unhappy">
        <summary className="flex items-center gap-2.5 px-4 py-2 hover:bg-accent/40">
          {branch}
          <span className="flex flex-1 items-center gap-1.5 text-sm text-muted-foreground">
            {plural(tests.length, "unhappy path")} · {flowSummary(states)}
            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open/unhappy:rotate-90" />
          </span>
          <span className="relative z-10">
            <RunButton target={{ appId, testIds: tests.map((t) => t.id) }} active={active.length > 0} stopIds={active} label="Run unhappy paths" />
          </span>
        </summary>
        <ItemGroup className="divide-y border-t">
          {tests.map((t) => (
            <TestLine key={t.id} appId={appId} test={t} state={state.get(t.id)!} run={runs.get(t.id)} />
          ))}
        </ItemGroup>
      </details>
    </div>
  );
}

function TestLine({ appId, test, state, run }: { appId: string; test: TestRow; state: TestState; run?: TestRunRow }) {
  const unhappy = Boolean(test.baseId);
  const steps = run?.result?.steps ?? [];
  const current = steps.findIndex((s) => s.status === "running");
  const setupSteps = run?.result?.setup?.steps ?? [];
  const inSetup = setupSteps.findIndex((s) => s.status === "running");
  let detail: React.ReactNode = null;
  if (state === "drafting") detail = <span className="text-muted-foreground">Writing the steps…</span>;
  else if (state === "running" && current < 0 && inSetup >= 0)
    detail = (
      <span className="text-live">
        Setup, step {inSetup + 1} of {setupSteps.length}
      </span>
    );
  else if (state === "running" && current >= 0)
    detail = (
      <span className="text-live">
        Step {current + 1} of {steps.length}
      </span>
    );
  else if (state === "queued") detail = <span className="text-live">Queued</span>;
  else if ((state === "fail" || state === "error") && run?.result?.failure) detail = <span className={state === "fail" ? "text-bad" : "text-warn"}>{run.result.failure}</span>;

  return (
    <ListItem className="flex-nowrap">
      {unhappy && branch}
      <ItemMedia>
        <StateMark state={state} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <Link href={`/apps/${appId}/tests/${test.id}`} className={cx("truncate outline-none after:absolute after:inset-0 focus-visible:underline", unhappy ? "text-muted-foreground" : "font-medium")}>
          {test.name}
        </Link>
        {detail && <span className="truncate text-sm">{detail}</span>}
      </ItemContent>
      <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">{run?.finishedAt && state !== "running" && state !== "queued" ? timeAgo(run.finishedAt) : ""}</span>
      <ItemActions>
        <RunButton target={{ appId, testIds: [test.id] }} active={state === "running" || state === "queued"} stopIds={[test.id]} label="Run test" disabled={state === "drafting"} />
      </ItemActions>
    </ListItem>
  );
}
