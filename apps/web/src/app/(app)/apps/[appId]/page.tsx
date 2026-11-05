import { appRollup, signingOf, walletUse } from "@dappdrill/core";
import { analyses, appTests, db, latestRuns, notWritten, runHistory, settledRuns, type TestRow, type TestRunRow } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { Flag, ListChecks, Route, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction } from "@/actions/apps";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddTest } from "@/components/tests/add-test";
import { AnalysisPanel } from "@/components/tests/analysis-panel";
import { AppHero } from "@/components/tests/app-hero";
import { HISTORY_DAYS } from "@/components/tests/app-stats";
import { ConditionGrid } from "@/components/tests/condition-grid";
import { ConditionBranches } from "@/components/tests/condition-branches";
import { RunButton } from "@/components/tests/run-button";
import { SetupCard } from "@/components/tests/setup-card";
import { readTest } from "@/components/tests/status";
import { DraftLine, ProblemCard, TestLine, TestList, type TestCardProps } from "@/components/tests/test-card";
import { SectionHead, Tile, type TINT } from "@/components/tests/tile";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { artifactUrl } from "@/lib/artifacts";
import { hostFromUrl, plural, timeAgo } from "@/lib/format";
import { requireApp } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

export default async function TestsPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { appId } = await params;
  const { view } = await searchParams;
  const { app } = await requireApp(appId);
  const [[analysis], tests] = await Promise.all([db().select().from(analyses).where(eq(analyses.appId, appId)).orderBy(desc(analyses.createdAt)).limit(1), appTests(db(), appId)]);
  const ids = tests.map((t) => t.id);
  const [latest, settled, history] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids), runHistory(db(), appId, new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000))]);
  const reads = new Map(tests.map((t) => [t.id, readTest(t, latest.get(t.id), settled.get(t.id))]));
  const untested = tests.filter(notWritten);
  const roots = tests.filter((t) => !t.baseId && !notWritten(t));
  const conditionsOf = (t: TestRow) => tests.filter((c) => c.baseId === t.id);
  // A row flags its conditions' signatures too: they only show as pills otherwise.
  const signingFor = (t: TestRow) => signingOf([t, ...conditionsOf(t)].flatMap((row) => settled.get(row.id)?.result?.signingReviews.map((r) => r.verdict) ?? []));
  const overall = appRollup(
    roots.map((t) => ({ read: reads.get(t.id)!, conditions: conditionsOf(t).map((c) => reads.get(c.id)!), signing: signingFor(t) })),
    untested.length,
  );
  // Worst first. A passed test can still need a look: a condition failed, or it signed something dangerous.
  const rank = (t: TestRow) => ["fail", "error"].indexOf(reads.get(t.id)!.settled) + 1 || 3;
  const needsLook = (t: TestRow) => rank(t) < 3 || signingFor(t).dangerous > 0 || conditionsOf(t).some((c) => reads.get(c.id)!.settled === "fail");
  const attention = roots.filter(needsLook).sort((a, b) => rank(a) - rank(b));
  // What's happening now comes first, conditions included.
  const liveRank = (t: TestRow) => {
    const all = [t, ...conditionsOf(t)].map((row) => reads.get(row.id)!);
    return all.some((r) => r.active === "running") ? 0 : all.some((r) => r.active === "queued") ? 1 : all.some((r) => r.drafting) ? 2 : 3;
  };
  const others = roots.filter((t) => !needsLook(t)).sort((a, b) => liveRank(a) - liveRank(b));
  // Only a test that stopped has a moment to show. One that passed with a problem stays a line.
  const stopped = attention.filter((t) => rank(t) < 3);
  const flagged = attention.filter((t) => rank(t) === 3);
  const host = hostFromUrl(app.url);

  const exploring = analysis && (analysis.status === "queued" || analysis.status === "running");
  const activeIds = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
  const anyActive = activeIds.length > 0 || tests.some((t) => reads.get(t.id)!.drafting);
  const lastRun = [...latest.values()]
    .map((r) => r.finishedAt)
    .filter((d) => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const grid = view === "grid";
  const setup = app.setup && { startPath: app.setup.startPath, steps: app.setup.steps.map((s) => s.text), when: app.setup.when, why: app.setup.why };
  const setupRun = app.setup ? lastSetup(app.setup.steps.map((s) => s.text), [...latest.values()]) : undefined;
  const setupCard = setup && <SetupCard appId={appId} setup={setup} last={setupRun} />;
  const cardProps = (t: TestRow): TestCardProps => ({ appId, url: app.url, test: t, read: reads.get(t.id)!, run: settled.get(t.id) ?? latest.get(t.id), live: latest.get(t.id), signs: walletUse(t.steps) === "signs", signing: signingFor(t), hasConditions: conditionsOf(t).length > 0 });
  const branches = (t: TestRow) => conditionsOf(t).length > 0 && <ConditionBranches appId={appId} tests={conditionsOf(t)} reads={reads} runs={settled} className="relative z-10" />;
  const fine = others.length + untested.length;

  return (
    <div className="page">
      {(exploring || anyActive) && <AutoRefresh every={2000} />}

      <TooltipProvider>
        <div className="flex flex-col gap-12">
          <AppHero
            appId={appId}
            name={app.name}
            url={app.url}
            lastRun={lastRun}
            wallet={app.settings.wallets[0]}
            chainId={(app.settings.chains[0] ?? app.chains[0])?.id}
            rollup={roots.length > 0 ? overall : undefined}
            running={activeIds.length}
            runs={history}
            action={roots.length > 0 && <RunButton target={{ appId, all: true }} active={activeIds.length > 0} label="Run all" size="md" primary />}
          />

          {analysis && <AnalysisPanel analysis={analysis} appId={appId} host={host} url={app.url} hasTests={tests.length > 0} />}

          {/* A setup that failed is why the tests below can't be trusted, so it goes first. */}
          {setupRun?.ok === false && setupCard}

          {tests.length > 0 ? (
            <div className="flex flex-col gap-6">
              {roots.length > 0 && <ViewSwitch appId={appId} grid={grid} tests={roots.length} />}
              {grid ? (
                <ConditionGrid appId={appId} tests={tests.filter((t) => !notWritten(t))} reads={reads} settled={settled} />
              ) : (
                <div className="flex flex-col gap-10">
                  {attention.length > 0 && (
                    <Group icon={Flag} tint="bad" title="Needs attention" detail={attentionText(stopped.length, flagged.length)}>
                      {stopped.map((t) => (
                        <ProblemCard key={t.id} {...cardProps(t)}>
                          {branches(t)}
                        </ProblemCard>
                      ))}
                      {flagged.length > 0 && (
                        <TestList>
                          {flagged.map((t) => (
                            <TestLine key={t.id} {...cardProps(t)}>
                              {branches(t)}
                            </TestLine>
                          ))}
                        </TestList>
                      )}
                    </Group>
                  )}
                  {fine > 0 && (
                    <Group icon={ListChecks} tint="fork" title={attention.length > 0 ? "Other tests" : "Tests"} detail={plural(fine, "test")}>
                      <TestList>
                        {others.map((t) => (
                          <TestLine key={t.id} {...cardProps(t)}>
                            {branches(t)}
                          </TestLine>
                        ))}
                        {untested.map((t) => (
                          <DraftLine key={t.id} appId={appId} test={t} />
                        ))}
                      </TestList>
                    </Group>
                  )}
                  <NewTest appId={appId} />
                </div>
              )}
            </div>
          ) : (
            !exploring && (
              <div className="flex flex-col gap-8">
                {!analysis && (
                  <section className="flex flex-col items-start gap-4">
                    <div className="flex flex-col gap-2">
                      <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">No tests yet</h2>
                      <p className="text-base text-muted-foreground">Let DappDrill explore {host} and find what users do there, or add a test yourself.</p>
                    </div>
                    <form action={analyzeAction.bind(null, appId)}>
                      <Button type="submit">Explore the app</Button>
                    </form>
                  </section>
                )}
                <NewTest appId={appId} />
              </div>
            )
          )}

          {!grid && tests.length > 0 && setupRun?.ok !== false && (setupCard ?? <SetupCard appId={appId} setup={null} />)}
        </div>
      </TooltipProvider>
    </div>
  );
}

function attentionText(stopped: number, flagged: number) {
  return [stopped > 0 && `${stopped} stopped`, flagged > 0 && `${flagged} passed with a problem`].filter(Boolean).join(", ");
}

function Group({ icon, tint, title, detail, children }: { icon: LucideIcon; tint: keyof typeof TINT; title: string; detail: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <SectionHead icon={icon} tint={tint} title={title} detail={detail} />
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** Laid out like a question on the New app page: what it asks on the left, the field on the right. */
function NewTest({ appId }: { appId: string }) {
  return (
    <section aria-label="Add a test" className="grid items-center gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8">
      <div className="flex items-center gap-3">
        <Tile icon={Route} tint="live" />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm leading-snug font-medium">What else should we test?</h2>
          <p className="text-sm text-muted-foreground">One sentence. We write the steps.</p>
        </div>
      </div>
      <AddTest appId={appId} />
    </section>
  );
}

function ViewSwitch({ appId, grid, tests }: { appId: string; grid: boolean; tests: number }) {
  const item = (href: string, label: React.ReactNode, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={cx("rounded-md px-3 py-1 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="View" className="flex w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {item(
        `/apps/${appId}`,
        <>
          Tests <span className="font-normal text-muted-foreground tabular-nums">{tests}</span>
        </>,
        !grid,
      )}
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
