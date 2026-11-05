import { walletUse } from "@dappdrill/core";
import { analyses, db, flowsWithTests, latestRuns, runHistory, type RunSummary, type TestRow, type TestRunRow } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction } from "@/actions/apps";
import { AutoRefresh } from "@/components/auto-refresh";
import { NewFlow } from "@/components/tests/add-test";
import { AnalysisPanel } from "@/components/tests/analysis-panel";
import { AppStats, HISTORY_DAYS, RunTicks } from "@/components/tests/app-stats";
import { FlowSection } from "@/components/tests/flow-section";
import { failureParts, PathPills } from "@/components/tests/path-pills";
import { RunButton } from "@/components/tests/run-button";
import { SetupCard } from "@/components/tests/setup-card";
import { isActive, REVEAL, STATE_LABEL, StateMark, stateOf, type TestState } from "@/components/tests/status";
import { cx, PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { artifactUrl } from "@/lib/artifacts";
import { hostFromUrl, timeAgo } from "@/lib/format";
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
  const [runs, history] = await Promise.all([
    latestRuns(
      db(),
      tests.map((t) => t.id),
    ),
    runHistory(db(), appId, new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000)),
  ]);
  const state = new Map(tests.map((t) => [t.id, stateOf(t, runs.get(t.id))]));
  const host = hostFromUrl(app.url);

  const exploring = analysis && (analysis.status === "queued" || analysis.status === "running");
  const anyActive = [...state.values()].some(isActive);
  const activeIds = tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
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
            {lastRun && (
              <>
                <span aria-hidden="true">·</span>
                <span>last run {timeAgo(lastRun)}</span>
              </>
            )}
          </p>
        }
        actions={tests.length > 0 && <RunButton target={{ appId, all: true }} active={activeIds.length > 0} label="Run all" size="md" primary />}
      />

      <TooltipProvider>
        <div className="flex flex-col gap-10">
          {analysis && <AnalysisPanel analysis={analysis} appId={appId} host={host} url={app.url} hasFlows={all.length > 0} />}

          {tests.length > 0 && <AppStats states={[...state.values()]} runs={history} />}

          {app.setup && (
            <SetupCard appId={appId} setup={app.setup && { startPath: app.setup.startPath, steps: app.setup.steps.map((s) => s.text), when: app.setup.when, why: app.setup.why }} last={app.setup ? lastSetup(app.setup.steps.map((s) => s.text), [...runs.values()]) : undefined} />
          )}

          {all.map((f) => {
            const states = f.tests.map((t) => state.get(t.id)!);
            const flowActive = f.tests.filter((t) => isActive(state.get(t.id)!) && state.get(t.id) !== "drafting").map((t) => t.id);
            return (
              <FlowSection key={f.id} appId={appId} flow={f} states={states} summary={flowSummary(states)} activeIds={flowActive}>
                <ul className="flex flex-col gap-1">
                  {f.tests
                    .filter((t) => !t.baseId)
                    .map((t) => {
                      const paths = f.tests.filter((c) => c.baseId === t.id);
                      const signs = walletUse(t.steps) === "signs";
                      return (
                        <li key={t.id}>
                          <TestLine appId={appId} test={t} state={state.get(t.id)!} run={runs.get(t.id)} history={history} signs={signs} hasPaths={paths.length > 0} />
                          {paths.length > 0 && <PathPills appId={appId} tests={paths} states={state} runs={runs} className="ml-7 pb-3" />}
                        </li>
                      );
                    })}
                </ul>
              </FlowSection>
            );
          })}

          {all.length > 0 ? (
            <div className="flex flex-col gap-4 md:px-5">
              <NewFlow appId={appId} />
              {!app.setup && <SetupCard appId={appId} setup={null} />}
            </div>
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
      </TooltipProvider>
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

/** Says the test signs. With no unhappy paths yet it's also the way to add them, in words on hover. */
function WalletMark({ href }: { href?: string }) {
  const icon = <Wallet className="size-3.5 shrink-0" aria-hidden="true" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className="relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {icon}
            <span className={cx("max-sm:sr-only", REVEAL, "group-hover/test:opacity-100")}>Add unhappy paths</span>
          </Link>
        ) : (
          <span role="img" aria-label="Asks the wallet to sign" className="relative z-10 shrink-0 text-muted-foreground">
            {icon}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>Asks the wallet to sign</TooltipContent>
    </Tooltip>
  );
}

function TestLine({ appId, test, state, run, history, signs, hasPaths }: { appId: string; test: TestRow; state: TestState; run?: TestRunRow; history: RunSummary[]; signs: boolean; hasPaths: boolean }) {
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
  else if ((state === "fail" || state === "error") && run?.result?.failure) {
    const { where, why } = failureParts(run.result.failure);
    detail = (
      <span title={run.result.failure}>
        <span className={cx("font-medium", state === "fail" ? "text-bad" : "text-warn")}>{where ?? STATE_LABEL[state]}</span>
        <span className="text-muted-foreground"> · {why}</span>
      </span>
    );
  }

  return (
    <div className="group/test relative -mx-3 flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/60">
      <StateMark state={state} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/apps/${appId}/tests/${test.id}`} className="truncate font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
            {test.name}
          </Link>
          {signs && <WalletMark href={hasPaths ? undefined : `/apps/${appId}/tests/${test.id}?add=unhappy#unhappy-paths`} />}
        </div>
        {detail && <p className="mt-0.5 line-clamp-2 text-sm sm:line-clamp-1">{detail}</p>}
      </div>
      <span className={cx("relative z-10 -my-1", state !== "running" && state !== "queued" && REVEAL, "group-hover/test:opacity-100")}>
        <RunButton target={{ appId, testIds: [test.id] }} active={state === "running" || state === "queued"} stopIds={[test.id]} label="Run test" disabled={state === "drafting"} />
      </span>
      <span className="mt-1 hidden shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums sm:flex">
        <RunTicks runs={history.filter((r) => r.testId === test.id)} />
        <span className="w-16 text-right">{run?.finishedAt && state !== "running" && state !== "queued" ? timeAgo(run.finishedAt) : ""}</span>
      </span>
    </div>
  );
}
