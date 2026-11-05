import { appRollup, appText, conditionsText, flowRollup, flowStatusText, signingOf, signingText, type FlowRollup } from "@dappdrill/core";
import { analyses, db, flowsWithTests, latestRuns, settledRuns, specOf, type TestRow, type TestRunRow } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction } from "@/actions/apps";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddTest, NewFlow } from "@/components/tests/add-test";
import { AnalysisPanel } from "@/components/tests/analysis-panel";
import { ConditionGrid } from "@/components/tests/condition-grid";
import { FlowHeader } from "@/components/tests/flow-header";
import { RunButton } from "@/components/tests/run-button";
import { SetupCard } from "@/components/tests/setup-card";
import { SigningFlag } from "@/components/tests/signing-flag";
import { ActiveDot, isActive, readTest, StateMark, type TestRead } from "@/components/tests/status";
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

export default async function FlowsPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { appId } = await params;
  const { view } = await searchParams;
  const { app } = await requireApp(appId);
  const [[analysis], all] = await Promise.all([db().select().from(analyses).where(eq(analyses.appId, appId)).orderBy(desc(analyses.createdAt)).limit(1), flowsWithTests(db(), appId)]);
  const tests = all.flatMap((f) => f.tests);
  const ids = tests.map((t) => t.id);
  const [latest, settled] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids)]);
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

      <div className="flex flex-col gap-6">
        {analysis && <AnalysisPanel analysis={analysis} appId={appId} host={host} url={app.url} hasFlows={all.length > 0} />}

        {!grid && (app.setup || all.length > 0) && (
          <SetupCard appId={appId} setup={app.setup && { startPath: app.setup.startPath, steps: app.setup.steps.map((s) => s.text), when: app.setup.when, why: app.setup.why }} last={app.setup ? lastSetup(app.setup.steps.map((s) => s.text), [...latest.values()]) : undefined} />
        )}

        {grid ? (
          <ConditionGrid appId={appId} flows={all} reads={reads} settled={settled} />
        ) : (
          all.map((f) => {
            const r = rollups.get(f.id)!;
            const flowActive = f.tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
            return (
              <section key={f.id} aria-label={f.name} className="overflow-hidden rounded-xl border bg-card shadow-xs">
                <FlowHeader appId={appId} flow={f} count={f.tests.filter((t) => !t.baseId).length} summary={<FlowSummary rollup={r} />} activeIds={flowActive} />
                {f.tests.length > 0 && (
                  <ItemGroup className="divide-y">
                    {f.tests
                      .filter((t) => !t.baseId)
                      .map((t) => {
                        const children = f.tests.filter((c) => c.baseId === t.id);
                        return [
                          <TestLine key={t.id} appId={appId} test={t} read={reads.get(t.id)!} run={settled.get(t.id) ?? latest.get(t.id)} live={latest.get(t.id)} />,
                          children.length > 0 && <ConditionGroup key={`${t.id}-conditions`} appId={appId} tests={children} reads={reads} settled={settled} latest={latest} />,
                        ];
                      })}
                  </ItemGroup>
                )}
                <div className={cx(f.tests.length > 0 && "border-t")}>
                  <AddTest appId={appId} flowId={f.id} flowName={f.name} first={f.tests.length === 0} />
                </div>
              </section>
            );
          })
        )}

        {all.length > 0 ? (
          !grid && <NewFlow appId={appId} />
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

const branch = <span aria-hidden="true" className="-mt-0.5 ml-1.5 h-4 w-3 shrink-0 self-start border-b border-l border-muted-foreground/30" />;

/** A test's conditions: one quiet row with the counts, opened when one failed, couldn't run or is running. */
function ConditionGroup({ appId, tests, reads, settled, latest }: { appId: string; tests: TestRow[]; reads: Map<string, TestRead>; settled: Map<string, TestRunRow>; latest: Map<string, TestRunRow> }) {
  const rs = tests.map((t) => reads.get(t.id)!);
  const open = rs.some((r) => r.settled === "fail" || r.settled === "error" || isActive(r));
  const active = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
  const rollup = flowRollup([{ read: { settled: "never" }, conditions: rs, signing: { dangerous: 0, check: 0 } }]);
  return (
    <div role="listitem">
      <details open={open} className="group/conditions">
        <summary className="flex items-center gap-2.5 px-4 py-2 hover:bg-accent/40">
          {branch}
          <span className="flex flex-1 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{plural(tests.length, "condition")}</span>
            <span aria-hidden="true">·</span>
            <span className={cx(rollup.conditions.failed > 0 && "text-warn")}>{conditionsText(rollup)}</span>
            {active.length > 0 && <ActiveDot active="running" />}
            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open/conditions:rotate-90" />
          </span>
          <span className="relative z-10">
            <RunButton target={{ appId, testIds: tests.map((t) => t.id) }} active={active.length > 0} stopIds={active} label="Run conditions" />
          </span>
        </summary>
        <ItemGroup className="divide-y border-t">
          {tests.map((t) => (
            <TestLine key={t.id} appId={appId} test={t} read={reads.get(t.id)!} run={settled.get(t.id) ?? latest.get(t.id)} live={latest.get(t.id)} />
          ))}
        </ItemGroup>
      </details>
    </div>
  );
}

/** One test or condition row. `run` is the result its status reads from; `live` the newest run, for progress. */
function TestLine({ appId, test, read, run, live }: { appId: string; test: TestRow; read: TestRead; run?: TestRunRow; live?: TestRunRow }) {
  const condition = Boolean(test.baseId);
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
  else if ((read.settled === "fail" || read.settled === "error") && run?.result?.failure) detail = <span className={read.settled === "fail" ? "text-bad" : "text-warn"}>{run.result.failure}</span>;
  else if (read.settled === "skipped") detail = <span className="text-muted-foreground">Doesn&apos;t apply{run?.result?.failure ? `: ${run.result.failure}` : ""}</span>;

  return (
    <ListItem className="flex-nowrap">
      {condition && branch}
      <ItemMedia>
        <StateMark state={read.mark} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/apps/${appId}/tests/${test.id}`} className={cx("truncate outline-none after:absolute after:inset-0 focus-visible:underline", condition ? "text-muted-foreground" : "font-medium")}>
            {specOf(test).name}
          </Link>
          {read.settled !== "never" && <ActiveDot active={read.active} />}
          {signingText(signing) && <SigningFlag signing={signing} short />}
        </span>
        {detail && <span className="truncate text-sm">{detail}</span>}
      </ItemContent>
      <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">{run?.finishedAt && !read.active ? timeAgo(run.finishedAt) : ""}</span>
      <ItemActions>
        <RunButton target={{ appId, testIds: [test.id] }} active={Boolean(read.active)} stopIds={[test.id]} label="Run test" disabled={read.drafting} />
      </ItemActions>
    </ListItem>
  );
}
