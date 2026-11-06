import { appRollup, signingOf, walletUse, type ExploreBug } from "@dappdrill/core";
import { appTests, db, explorations, latestRuns, notWritten, runHistory, settledRuns, type TestRow } from "@dappdrill/db";
import { desc, eq, sql } from "drizzle-orm";
import { ArrowRight, Compass, GitFork, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { exploreAction } from "@/actions/explore";
import { AutoRefresh } from "@/components/auto-refresh";
import { Bugs } from "@/components/explore/bugs";
import { PassBand } from "@/components/explore/live";
import { PassNotice } from "@/components/explore/notice";
import { Suggested } from "@/components/explore/suggested";
import { Tried } from "@/components/explore/tried";
import { AddTest, AddTestButton } from "@/components/tests/add-test";
import { AppHero } from "@/components/tests/app-hero";
import { HISTORY_DAYS } from "@/components/tests/app-stats";
import { ConditionBranches } from "@/components/tests/condition-branches";
import { ConditionGrid } from "@/components/tests/condition-grid";
import { lastSetup } from "@/components/tests/last-setup";
import { RunButton } from "@/components/tests/run-button";
import { readTest } from "@/components/tests/status";
import { DraftLine, TestLine, TestList, type TestCardProps } from "@/components/tests/test-card";
import { Tile } from "@/components/tests/tile";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { appBugs, liveView, passRunning, suggestedTests, triedLines, type PassBugs, type TriedKind } from "@/lib/explore";
import { hostFromUrl } from "@/lib/format";
import { requireApp } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

type Tab = "tests" | "bugs" | "tried";
type Show = "all" | "attention" | "passed" | "waiting" | "drafts";

const SHOWS: Show[] = ["attention", "passed", "waiting", "drafts"];
const KINDS: TriedKind[] = ["pass", "fail", "error", "gap"];

/** How many earlier passes are searched for bugs they confirmed. */
const EARLIER_PASSES = 10;

export default async function AppPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ tab?: string; show?: string; view?: string; kind?: string }> }) {
  const { appId } = await params;
  const query = await searchParams;
  const { app } = await requireApp(appId);
  const [[pass], earlier, tests] = await Promise.all([
    db().select().from(explorations).where(eq(explorations.appId, appId)).orderBy(desc(explorations.createdAt)).limit(1),
    // Only the bugs of earlier passes: a whole state is too heavy to load every two seconds.
    db()
      .select({ id: explorations.id, triage: explorations.triage, bugs: sql<ExploreBug[] | null>`${explorations.state}->'bugs'` })
      .from(explorations)
      .where(eq(explorations.appId, appId))
      .orderBy(desc(explorations.createdAt))
      .limit(EARLIER_PASSES),
    appTests(db(), appId),
  ]);
  const ids = tests.map((t) => t.id);
  const [latest, settled, history] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids), runHistory(db(), appId, new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000))]);
  const reads = new Map(tests.map((t) => [t.id, readTest(t, latest.get(t.id), settled.get(t.id))]));
  const untested = tests.filter(notWritten);
  const roots = tests.filter((t) => !t.baseId && !notWritten(t));
  const conditionsOf = (t: TestRow) => tests.filter((c) => c.baseId === t.id);
  // A row flags its conditions' signatures too: they only show as pills otherwise.
  const signingFor = (t: TestRow) => signingOf([t, ...conditionsOf(t)].flatMap((row) => settled.get(row.id)?.result?.signingReviews.map((r) => r.verdict) ?? []));
  // A draft hasn't passed yet, so it stays out of the list and doesn't count for or against the app.
  const counted = roots.filter((t) => !t.draftNote);
  const drafts = roots.filter((t) => t.draftNote);
  // The same signature comes up in many tests and under every condition; the headline counts each one once.
  const signatures = new Map(counted.flatMap((t) => [t, ...conditionsOf(t)]).flatMap((row) => settled.get(row.id)?.result?.signingReviews ?? []).map((r) => [`${r.verdict} ${r.title}`, r.verdict]));
  const overall = {
    ...appRollup(
      counted.map((t) => ({ read: reads.get(t.id)!, conditions: conditionsOf(t).map((c) => reads.get(c.id)!), signing: signingFor(t) })),
      untested.length,
    ),
    signing: signingOf([...signatures.values()]),
  };
  // Worst first. A passed test can still need a look: a condition failed, or it signed something dangerous.
  const rank = (t: TestRow) => ["fail", "error"].indexOf(reads.get(t.id)!.settled) + 1 || 3;
  const needsLook = (t: TestRow) => rank(t) < 3 || signingFor(t).dangerous > 0 || conditionsOf(t).some((c) => reads.get(c.id)!.settled === "fail");
  const attention = counted.filter(needsLook).sort((a, b) => rank(a) - rank(b));
  const exploring = passRunning(pass);
  // The app was explored and nothing passed: the page says why, and offers the way to try again once.
  const notice = Boolean(pass) && !exploring && counted.length === 0;
  // What's happening now comes first, conditions included. While the app is explored the list only grows at the end, so nothing jumps.
  const liveRank = (t: TestRow) => {
    const all = [t, ...conditionsOf(t)].map((row) => reads.get(row.id)!);
    return all.some((r) => r.active === "running") ? 0 : all.some((r) => r.active === "queued") ? 1 : all.some((r) => r.drafting) ? 2 : 3;
  };
  const others = counted.filter((t) => !needsLook(t));
  const all = exploring ? counted : [...attention, ...others.sort((a, b) => liveRank(a) - liveRank(b))];
  // The same counts as the top of the page, so a test that passed with a problem is under both Passed and Needs attention.
  const passed = all.filter((t) => reads.get(t.id)!.settled === "pass");
  const waiting = all.filter((t) => reads.get(t.id)!.settled === "never");
  const counts: Record<Show, number> = { all: counted.length + untested.length, attention: attention.length, passed: passed.length, waiting: waiting.length + untested.length, drafts: drafts.length };
  // A filter that has emptied since the link was made falls back to everything.
  const fallback: Show = counts.all > 0 || drafts.length === 0 ? "all" : "drafts";
  const wanted = SHOWS.find((s) => s === query.show);
  const showing: Show = wanted && counts[wanted] > 0 ? wanted : fallback;
  const listed = { all, attention, passed, waiting, drafts }[showing];
  const host = hostFromUrl(app.url);

  const state = pass?.state ?? undefined;
  const suggested = suggestedTests(pass, new Set(tests.map((t) => t.name)));
  const bugs = appBugs(earlier as PassBugs[]);
  const tried = state ? triedLines(state) : [];
  const explored = Boolean(state && (state.suggested.length > 0 || state.checks.length > 0 || state.bugs.length > 0));
  const tab: Tab = pass && query.tab === "bugs" ? "bugs" : pass && query.tab === "tried" ? "tried" : "tests";
  const grid = tab === "tests" && query.view === "grid" && counted.length > 0;

  const activeIds = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
  const anyActive = activeIds.length > 0 || tests.some((t) => reads.get(t.id)!.drafting);
  const lastRun = [...latest.values()]
    .map((r) => r.finishedAt)
    .filter((d) => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const setupFailed = app.setup ? lastSetup(app.setup.steps.map((s) => s.text), [...latest.values()])?.failed : false;
  const cardProps = (t: TestRow): TestCardProps => ({ appId, test: t, read: reads.get(t.id)!, run: settled.get(t.id) ?? latest.get(t.id), live: latest.get(t.id), signs: walletUse(t.steps) === "signs", signing: signingFor(t), hasConditions: conditionsOf(t).length > 0 });
  const branches = (t: TestRow) => conditionsOf(t).length > 0 && <ConditionBranches appId={appId} tests={conditionsOf(t)} reads={reads} runs={settled} className="relative z-10" />;
  const nothing = listed.length === 0 && !((showing === "all" || showing === "waiting") && untested.length > 0);

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
            rollup={!exploring && counted.length > 0 ? overall : undefined}
            running={activeIds.length}
            runs={history}
            action={
              !exploring &&
              (tests.length > 0 || explored) && (
                <div className="flex items-center gap-2">
                  <AddTestButton appId={appId} />
                  {!notice && (
                    <form action={exploreAction.bind(null, appId)}>
                      <Button type="submit" variant="outline">
                        <Compass aria-hidden="true" />
                        Explore again
                      </Button>
                    </form>
                  )}
                  {roots.length > 0 && <RunButton target={{ appId, all: true }} active={activeIds.length > 0} label="Run all" size="md" primary />}
                </div>
              )
            }
          />

          {pass && exploring && <PassBand view={liveView(pass, app.url)} />}
          {pass && notice && <PassNotice pass={pass} appId={appId} suggested={suggested.length} />}

          {tests.length > 0 || explored ? (
            <div className="flex flex-col gap-6">
              {pass && <Tabs appId={appId} tab={tab} tests={counted.length} bugs={bugs.open.length} tried={state?.checks.length ?? 0} />}
              {tab === "bugs" && <Bugs open={bugs.open} setAside={bugs.setAside} running={exploring} explored={explored} appUrl={app.url} />}
              {tab === "tried" && <Tried appId={appId} lines={tried} kind={KINDS.find((k) => k === query.kind)} tests={new Map(tests.map((t) => [t.name, t.id]))} running={exploring} />}
              {tab === "tests" && (
                <div className="flex flex-col gap-8">
                  {/* A setup that failed is why these results can't be trusted, so it can't wait in Settings. */}
                  {setupFailed && <SetupWarning appId={appId} />}
                  {grid ? (
                    <div className="flex flex-col gap-4">
                      <Link href={`/apps/${appId}`} scroll={false} className="w-fit rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                        Back to the list
                      </Link>
                      <ConditionGrid appId={appId} tests={tests.filter((t) => !notWritten(t) && !t.draftNote)} reads={reads} settled={settled} />
                    </div>
                  ) : notice && counts.all + drafts.length === 0 ? null : (
                    <TestList filter={counts.all + drafts.length > 0 && <TestFilter appId={appId} showing={showing} counts={counts} conditions={tests.some((t) => t.baseId)} />}>
                      {listed.map((t) => (
                        <TestLine key={t.id} {...cardProps(t)}>
                          {branches(t)}
                        </TestLine>
                      ))}
                      {(showing === "all" || showing === "waiting") && untested.map((t) => <DraftLine key={t.id} appId={appId} test={t} />)}
                      {nothing && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{exploring ? "A test shows here once it has passed on a clean fork." : "No tests yet."}</li>}
                    </TestList>
                  )}
                  {!grid && pass && <Suggested tests={suggested} passId={pass.id} running={exploring} />}
                </div>
              )}
            </div>
          ) : (
            !exploring && (
              <div className="flex flex-col gap-8">
                {!pass && (
                  <section className="flex flex-col items-start gap-4">
                    <div className="flex flex-col gap-2">
                      <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">No tests yet</h2>
                      <p className="text-base text-muted-foreground">Let DappDrill explore {host} and find what users do there, or add a test yourself.</p>
                    </div>
                    <form action={exploreAction.bind(null, appId)}>
                      <Button type="submit">Explore the app</Button>
                    </form>
                  </section>
                )}
                <AddTest appId={appId} placeholder="What should we test?" className="w-full max-w-md" />
              </div>
            )
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

function SetupWarning({ appId }: { appId: string }) {
  return (
    <Link href={`/apps/${appId}/settings#setup`} className="flex items-center gap-3 rounded-xl border border-warn-line bg-warn-soft p-3 shadow-sm transition-colors outline-none hover:border-warn-bar focus-visible:ring-2 focus-visible:ring-ring">
      <Tile icon={TriangleAlert} tint="warn" />
      <span className="min-w-0 flex-1 text-pretty">Setup didn&apos;t finish, so these results can&apos;t be trusted.</span>
      <span className="flex shrink-0 items-center gap-1 pr-1 font-medium">
        See setup
        <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </Link>
  );
}

const FILTERS: { show: Show; label: string }[] = [
  { show: "all", label: "All" },
  { show: "attention", label: "Needs attention" },
  { show: "passed", label: "Passed" },
  { show: "waiting", label: "Not run yet" },
  { show: "drafts", label: "Drafts" },
];

/** The list's own header. Worst comes first anyway, so this is for narrowing down, and it only offers what's there. */
function TestFilter({ appId, showing, counts, conditions }: { appId: string; showing: Show; counts: Record<Show, number>; conditions: boolean }) {
  return (
    <nav aria-label="Filter tests" className="flex flex-wrap items-center gap-0.5 p-1.5">
      {FILTERS.filter((f) => f.show === "all" || counts[f.show] > 0).map(({ show, label }) => (
        <Link
          key={show}
          href={show === "all" ? `/apps/${appId}` : `/apps/${appId}?show=${show}`}
          scroll={false}
          aria-current={show === showing ? "true" : undefined}
          className={cx("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", show === showing ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {label}
          {show !== "all" && <span className={cx("font-normal tabular-nums", show === "attention" ? "text-bad" : "text-muted-foreground")}>{counts[show]}</span>}
        </Link>
      ))}
      {conditions && (
        <Link href={`/apps/${appId}?view=grid`} scroll={false} className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <GitFork className="size-3.5 text-fork" aria-hidden="true" />
          By condition
        </Link>
      )}
    </nav>
  );
}

function Tabs({ appId, tab, tests, bugs, tried }: { appId: string; tab: Tab; tests: number; bugs: number; tried: number }) {
  const item = (to: Tab, label: ReactNode) => (
    <Link
      href={to === "tests" ? `/apps/${appId}` : `/apps/${appId}?tab=${to}`}
      scroll={false}
      aria-current={to === tab ? "page" : undefined}
      className={cx("flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", to === tab ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </Link>
  );
  const count = (n: number, bad = false) => <span className={cx("font-normal tabular-nums", bad && n > 0 ? "text-bad" : "text-muted-foreground")}>{n}</span>;
  return (
    <nav aria-label="View" className="flex w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {item("tests", <>Tests {count(tests)}</>)}
      {item("bugs", <>Bugs {count(bugs, true)}</>)}
      {item("tried", <>Tried {count(tried)}</>)}
    </nav>
  );
}
