import { appRollup, appText, conditionsText, flowRollup, flowStatusText, signingOf, signingText, walletUse, type FlowRollup } from "@dappdrill/core";
import { analyses, db, flowsWithTests, latestRuns, runHistory, settledRuns, specOf, type RunSummary, type TestRow, type TestRunRow } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction } from "@/actions/apps";
import { AutoRefresh } from "@/components/auto-refresh";
import { NewFlow } from "@/components/tests/add-test";
import { AnalysisPanel } from "@/components/tests/analysis-panel";
import { AppStats, HISTORY_DAYS, RunTicks } from "@/components/tests/app-stats";
import { ConditionGrid } from "@/components/tests/condition-grid";
import { ConditionPills, failureParts } from "@/components/tests/condition-pills";
import { FlowSection } from "@/components/tests/flow-section";
import { RunButton } from "@/components/tests/run-button";
import { SetupCard } from "@/components/tests/setup-card";
import { SigningFlag } from "@/components/tests/signing-flag";
import { ActiveDot, readTest, REVEAL, STATE_LABEL, StateMark, type TestRead } from "@/components/tests/status";
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

export default async function FlowsPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { appId } = await params;
  const { view } = await searchParams;
  const { app } = await requireApp(appId);
  const [[analysis], all] = await Promise.all([db().select().from(analyses).where(eq(analyses.appId, appId)).orderBy(desc(analyses.createdAt)).limit(1), flowsWithTests(db(), appId)]);
  const tests = all.flatMap((f) => f.tests);
  const ids = tests.map((t) => t.id);
  const [latest, settled, history] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids), runHistory(db(), appId, new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000))]);
  const reads = new Map(tests.map((t) => [t.id, readTest(t, latest.get(t.id), settled.get(t.id))]));
  const rollups = new Map(all.map((f) => [f.id, rollupOf(f.tests, reads, settled)]));
  const overall = appRollup([...rollups.values()]);
  const host = hostFromUrl(app.url);

  const exploring = analysis && (analysis.status === "queued" || analysis.status === "running");
  const activeIds = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
  const anyActive = activeIds.length > 0 || tests.some((t) => reads.get(t.id)!.drafting);
  const lastRun = [...latest.values()]
    .map((r) => r.finishedAt)
    .filter((d) => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const signing = signingText(overall.signing);
  const grid = view === "grid";

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
            {all.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className={cx(overall.status === "fail" && "text-bad", overall.status === "error" && "text-warn")}>{appText(overall)}</span>
                {signing && (
                  <>
                    <span aria-hidden="true">·</span>
                    <SigningFlag signing={overall.signing} />
                  </>
                )}
                {lastRun && (
                  <>
                    <span aria-hidden="true">·</span>
                    <Link href={`/apps/${appId}/runs`} className="hover:text-foreground hover:underline">
                      last run {timeAgo(lastRun)}
                    </Link>
                  </>
                )}
              </>
            )}
          </p>
        }
        actions={
          tests.length > 0 && (
            <>
              <ViewSwitch appId={appId} grid={grid} />
              <RunButton target={{ appId, all: true }} active={activeIds.length > 0} label="Run all" size="md" primary />
            </>
          )
        }
      />

      <TooltipProvider>
        <div className="flex flex-col gap-10">
          {analysis && <AnalysisPanel analysis={analysis} appId={appId} host={host} url={app.url} hasFlows={all.length > 0} />}

          {tests.length > 0 && <AppStats states={tests.filter((t) => !t.baseId).map((t) => reads.get(t.id)!.mark)} conditionsFailed={overall.conditionsFailed} runs={history} />}

          {!grid && app.setup && (
            <SetupCard appId={appId} setup={{ startPath: app.setup.startPath, steps: app.setup.steps.map((s) => s.text), when: app.setup.when, why: app.setup.why }} last={lastSetup(app.setup.steps.map((s) => s.text), [...latest.values()])} />
          )}

          {grid ? (
            <ConditionGrid appId={appId} flows={all} reads={reads} settled={settled} />
          ) : (
            all.map((f) => {
              const base = f.tests.filter((t) => !t.baseId);
              const flowActive = f.tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
              return (
                <FlowSection key={f.id} appId={appId} flow={f} states={base.map((t) => reads.get(t.id)!.mark)} summary={<FlowSummary rollup={rollups.get(f.id)!} />} activeIds={flowActive}>
                  <ul className="flex flex-col gap-1">
                    {base.map((t) => {
                      const conditions = f.tests.filter((c) => c.baseId === t.id);
                      return (
                        <li key={t.id}>
                          <TestLine appId={appId} test={t} read={reads.get(t.id)!} run={settled.get(t.id) ?? latest.get(t.id)} live={latest.get(t.id)} history={history} signs={walletUse(t.steps) === "signs"} hasConditions={conditions.length > 0} />
                          {conditions.length > 0 && <ConditionPills appId={appId} tests={conditions} reads={reads} runs={settled} className="ml-7 pb-3" />}
                        </li>
                      );
                    })}
                  </ul>
                </FlowSection>
              );
            })
          )}

          {all.length > 0 ? (
            !grid && (
              <div className="flex flex-col gap-4 md:px-5">
                <NewFlow appId={appId} />
                {!app.setup && <SetupCard appId={appId} setup={null} />}
              </div>
            )
          ) : !exploring ? (
            <div className="flex flex-col gap-4">
              {!analysis && (
                <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-6 shadow-xs">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold">No flows yet</h2>
                    <p className="text-sm text-muted-foreground">Let DappDrill explore {host} and find what users do there, or add a flow yourself.</p>
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

/** The flow's rollup: its tests' reads, each test's condition reads, and the signing verdicts of their latest finished results. */
function rollupOf(tests: TestRow[], reads: Map<string, TestRead>, settled: Map<string, TestRunRow>): FlowRollup {
  const verdicts = (ids: string[]) => ids.flatMap((id) => settled.get(id)?.result?.signingReviews.map((r) => r.verdict) ?? []);
  return flowRollup(
    tests
      .filter((t) => !t.baseId)
      .map((t) => {
        const children = tests.filter((c) => c.baseId === t.id);
        return { read: reads.get(t.id)!, conditions: children.map((c) => reads.get(c.id)!), signing: signingOf(verdicts([t.id, ...children.map((c) => c.id)])) };
      }),
  );
}

/** Under the flow's name: its status, then its conditions, then anything the signing review flagged. */
function FlowSummary({ rollup: r }: { rollup: FlowRollup }) {
  if (r.status === "untested") return <span>Not tested</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span className={cx(r.status === "fail" && "text-bad", r.status === "error" && "text-warn")}>{flowStatusText(r)}</span>
      {r.active && <ActiveDot active="running" />}
      <span aria-hidden="true">·</span>
      <span className={cx(r.conditions.failed > 0 && "text-warn")}>Conditions: {conditionsText(r)}</span>
      {signingText(r.signing) && (
        <>
          <span aria-hidden="true">·</span>
          <SigningFlag signing={r.signing} />
        </>
      )}
    </span>
  );
}

function ViewSwitch({ appId, grid }: { appId: string; grid: boolean }) {
  const item = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={cx("rounded-md px-2.5 py-1 text-sm transition-colors", on ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="View" className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {item(`/apps/${appId}`, "List", !grid)}
      {item(`/apps/${appId}?view=grid`, "Conditions", grid)}
    </nav>
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

/** Says the test signs. With no conditions yet it's also the way to add them, in words on hover. */
function WalletMark({ href }: { href?: string }) {
  const icon = <Wallet className="size-3.5 shrink-0" aria-hidden="true" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className="relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {icon}
            <span className={cx("max-sm:sr-only", REVEAL, "group-hover/test:opacity-100")}>Add conditions</span>
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

/** One test. `run` is the result its status reads from; `live` the newest run, for progress. */
function TestLine({ appId, test, read, run, live, history, signs, hasConditions }: { appId: string; test: TestRow; read: TestRead; run?: TestRunRow; live?: TestRunRow; history: RunSummary[]; signs: boolean; hasConditions: boolean }) {
  const steps = live?.result?.steps ?? [];
  const current = steps.findIndex((s) => s.status === "running");
  const setupSteps = live?.result?.setup?.steps ?? [];
  const inSetup = setupSteps.findIndex((s) => s.status === "running");
  const signing = signingOf(run?.result?.signingReviews.map((r) => r.verdict) ?? []);
  let detail: React.ReactNode = null;
  if (read.drafting) detail = <span className="text-muted-foreground">Writing the steps…</span>;
  else if (read.active === "running" && current < 0 && inSetup >= 0)
    detail = (
      <span className="text-live">
        Setup, step {inSetup + 1} of {setupSteps.length}
      </span>
    );
  else if (read.active === "running" && current >= 0)
    detail = (
      <span className="text-live">
        Step {current + 1} of {steps.length}
      </span>
    );
  else if (read.active === "queued" && read.settled === "never") detail = <span className="text-live">Queued</span>;
  else if ((read.settled === "fail" || read.settled === "error") && run?.result?.failure) {
    const { where, why } = failureParts(run.result.failure);
    detail = (
      <span title={run.result.failure}>
        <span className={cx("font-medium", read.settled === "fail" ? "text-bad" : "text-warn")}>{where ?? STATE_LABEL[read.settled]}</span>
        <span className="text-muted-foreground"> · {why}</span>
      </span>
    );
  } else if (read.settled === "skipped") detail = <span className="text-muted-foreground">Doesn&apos;t apply{run?.result?.failure ? `: ${run.result.failure}` : ""}</span>;

  return (
    <div className="group/test relative -mx-3 flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/60">
      <StateMark state={read.mark} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/apps/${appId}/tests/${test.id}`} className="truncate font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
            {specOf(test).name}
          </Link>
          {read.settled !== "never" && <ActiveDot active={read.active} />}
          {signingText(signing) && <SigningFlag signing={signing} short />}
          {signs && <WalletMark href={hasConditions ? undefined : `/apps/${appId}/tests/${test.id}?add=conditions#conditions`} />}
        </div>
        {detail && <p className="mt-0.5 line-clamp-2 text-sm sm:line-clamp-1">{detail}</p>}
      </div>
      <span className={cx("relative z-10 -my-1", !read.active && REVEAL, "group-hover/test:opacity-100")}>
        <RunButton target={{ appId, testIds: [test.id] }} active={Boolean(read.active)} stopIds={[test.id]} label="Run test" disabled={read.drafting} />
      </span>
      <span className="mt-1 hidden shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums sm:flex">
        <RunTicks runs={history.filter((r) => r.testId === test.id)} />
        <span className="w-16 text-right">{run?.finishedAt && !read.active ? timeAgo(run.finishedAt) : ""}</span>
      </span>
    </div>
  );
}
