import { appRollup, signingOf, walletUse, type ExploreBug, type SecondLook, type Settled } from "@dappdrill/core";
import { appTests, db, explorations, latestRuns, notWritten, runHistory, settledRuns, type TestRow } from "@dappdrill/db";
import { desc, eq, sql } from "drizzle-orm";
import { ArrowRight, Compass, GitFork, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { exploreAction } from "@/actions/explore";
import { AutoRefresh } from "@/components/auto-refresh";
import { ExploredBug, lookBug, SetAside, TestBug } from "@/components/explore/bugs";
import { PassBand } from "@/components/explore/live";
import { PassNotice } from "@/components/explore/notice";
import { KIND, Outcomes } from "@/components/explore/outcomes";
import { Suggested, SuggestedPlaceholder } from "@/components/explore/suggested";
import { Tried } from "@/components/explore/tried";
import { AddTestButton, type AddTestProps } from "@/components/tests/add-test";
import { AppHero } from "@/components/tests/app-hero";
import { HISTORY_DAYS } from "@/components/tests/app-stats";
import { ConditionBranches } from "@/components/tests/condition-branches";
import { ConditionGrid } from "@/components/tests/condition-grid";
import { lastSetup } from "@/components/tests/last-setup";
import { RunButton } from "@/components/tests/run-button";
import { isActive, OUR_ERROR, readTest, withSettled, type TestRead } from "@/components/tests/status";
import { DraftLine, TestLine, TestList, type TestCardProps } from "@/components/tests/test-card";
import { Tile } from "@/components/tests/tile";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { appBugs, liveView, passRunning, suggestedTests, triedLines, type Added, type AppBug, type PassBugs, type TriedKind } from "@/lib/explore";
import { hostFromUrl } from "@/lib/format";
import { requireApp } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

type Tab = "tests" | "checks" | "bugs";
type Show = "all" | "failed" | "input" | "passed" | "waiting";
type From = "test" | "check";

const SHOWS: Show[] = ["failed", "input", "passed", "waiting"];

/**
 * One line of the Bugs tab. A bug comes from a test (the explorer was trying it, or it failed later
 * and a second look said the app is wrong) or from a check an explorer made once. `test` is the test
 * it came from or the one written for it since; `look` is set when a test's second look is all there is.
 */
interface BugItem {
  id: string;
  name: string;
  confirmed: boolean;
  byTest: boolean;
  test?: TestRow;
  explored?: AppBug;
  look?: SecondLook;
}
const KINDS: TriedKind[] = ["pass", "fail", "error", "gap"];

/** How many earlier passes are searched for bugs they confirmed. */
const EARLIER_PASSES = 10;

export default async function AppPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: Promise<{ tab?: string; show?: string; view?: string; kind?: string; from?: string; bug?: string }> }) {
  const { appId } = await params;
  const query = await searchParams;
  const { app } = await requireApp(appId);
  const [[pass], earlier, tests] = await Promise.all([
    db().select().from(explorations).where(eq(explorations.appId, appId)).orderBy(desc(explorations.createdAt)).limit(1),
    // Only the bugs of earlier passes, and the test each was found by: a whole state is too heavy to load every two seconds.
    db()
      .select({
        id: explorations.id,
        triage: explorations.triage,
        bugs: sql<ExploreBug[] | null>`${explorations.state}->'bugs'`,
        titles: sql<Record<string, string> | null>`(select jsonb_object_agg(s->>'bugId', s->'draft'->>'name') from jsonb_array_elements(${explorations.state}->'suggested') s where s->>'bugId' is not null)`,
      })
      .from(explorations)
      .where(eq(explorations.appId, appId))
      .orderBy(desc(explorations.createdAt))
      .limit(EARLIER_PASSES),
    appTests(db(), appId),
  ]);
  const ids = tests.map((t) => t.id);
  const [latest, settled, history] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids), runHistory(db(), appId, new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000))]);
  const reads = new Map<string, TestRead>(tests.map((t) => [t.id, readTest(t, latest.get(t.id), settled.get(t.id))]));
  const untested = tests.filter(notWritten);
  const roots = tests.filter((t) => !t.baseId && !notWritten(t));
  const conditionsOf = (t: TestRow) => tests.filter((c) => c.baseId === t.id);
  // A row flags its conditions' signatures too: they only show as pills otherwise.
  const signingFor = (t: TestRow) => signingOf([t, ...conditionsOf(t)].flatMap((row) => settled.get(row.id)?.result?.signingReviews.map((r) => r.verdict) ?? []));

  // A bug an explorer found goes with the test it was found by, or the one written for it. Once that test passes, the bug is fixed.
  const bugTests = new Map(tests.flatMap((t) => (t.bugId ? [[t.bugId, { id: t.id, appId, active: reads.get(t.id)!.active, settled: reads.get(t.id)!.settled }] as const] : [])));
  const found = appBugs(earlier as PassBugs[], bugTests);
  const byId = new Map(roots.map((t) => [t.id, t]));
  const byName = new Map(roots.map((t) => [t.name, t]));
  const bugs: BugItem[] = [];
  for (const b of found.open) {
    // The test written for it, then the test the explorer was on, then (before tests had their own names) one named like the bug.
    const test = (b.test && byId.get(b.test.id)) ?? (b.title ? byName.get(b.title) : undefined) ?? byName.get(b.bug.name);
    const read = test && reads.get(test.id)!;
    if (test && read?.settled === "pass") found.setAside.push({ ...b, triage: "fixed", test: { id: test.id, appId, active: read.active, settled: read.settled } });
    else bugs.push({ id: b.bug.id, name: b.bug.name, confirmed: b.bug.status === "confirmed", byTest: Boolean(b.title) || b.bug.source === "prove", test, explored: b });
  }
  // A test with a confirmed bug is Failed whatever its last run said; with one still under review it is Probably failed at most.
  for (const t of roots) {
    const mine = bugs.filter((b) => b.test === t);
    const read = reads.get(t.id)!;
    if (mine.length > 0) reads.set(t.id, withSettled(read, mine.some((b) => b.confirmed) ? "fail" : read.settled === "never" ? "probable" : read.settled));
  }
  // A test that failed, and whose second look said the app is wrong, found a bug of its own.
  for (const t of roots) {
    const run = settled.get(t.id);
    const look = run?.result?.secondLook;
    if (bugs.some((b) => b.test === t) || reads.get(t.id)!.settled !== "fail" || look?.verdict !== "app") continue;
    bugs.push({ id: t.id, name: lookBug(look, t.expected, run?.result?.failure).name, confirmed: true, byTest: true, test: t, look });
  }
  bugs.sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
  const confirmedBugs = bugs.filter((b) => b.confirmed).length;
  // A bug on a test in the list shows as that test failing; the rest came out of the checks.
  const checkBugs = bugs.filter((b) => b.confirmed && !(b.byTest && b.test)).length;
  const bugHref = (id: string) => `/apps/${appId}?tab=bugs&bug=${id}#${id}`;

  // Suggested holds what hasn't run: a test the pass wrote stays there until a run says something about it.
  const written = new Set((pass?.state?.suggested ?? []).map((s) => s.draft.name));
  const unrun = roots.filter((t) => t.draftNote && reads.get(t.id)!.settled === "never" && written.has(t.name));
  const listedTests = roots.filter((t) => !unrun.includes(t));
  // Tests that have passed at least once: the ones that run on a schedule.
  const proved = roots.filter((t) => !t.draftNote);
  // The same signature comes up in many tests and under every condition; the headline counts each one once.
  const signatures = new Map(listedTests.flatMap((t) => [t, ...conditionsOf(t)]).flatMap((row) => settled.get(row.id)?.result?.signingReviews ?? []).map((r) => [`${r.verdict} ${r.title}`, r.verdict]));
  const overall = {
    ...appRollup(
      listedTests.map((t) => ({ read: reads.get(t.id)!, conditions: conditionsOf(t).map((c) => reads.get(c.id)!), signing: signingFor(t) })),
      untested.length,
    ),
    signing: signingOf([...signatures.values()]),
  };
  const settledOf = (t: TestRow) => reads.get(t.id)!.settled;
  // Worst first: failed, probably failed, needs your input. A passed test can still need a look: a condition failed, or it signed something dangerous.
  const rank = (t: TestRow) => ["fail", "probable", "input"].indexOf(settledOf(t)) + 1 || 4;
  const needsLook = (t: TestRow) => rank(t) < 4 || signingFor(t).dangerous > 0 || conditionsOf(t).some((c) => reads.get(c.id)!.settled === "fail");
  const exploring = passRunning(pass);
  // The app was explored and nothing passed: the page says why, and offers the way to try again once.
  const notice = Boolean(pass) && !exploring && proved.length === 0;
  // What's happening now comes first, conditions included. While the app is explored the list only grows at the end, so nothing jumps.
  const liveRank = (t: TestRow) => {
    const all = [t, ...conditionsOf(t)].map((row) => reads.get(row.id)!);
    return all.some((x) => x.active === "running") ? 0 : all.some((x) => x.active === "queued") ? 1 : all.some((x) => x.drafting) ? 2 : 3;
  };
  const all = exploring ? listedTests : [...listedTests.filter(needsLook).sort((a, b) => rank(a) - rank(b)), ...listedTests.filter((t) => !needsLook(t)).sort((a, b) => liveRank(a) - liveRank(b))];
  const only = (...states: Settled[]) => all.filter((t) => states.includes(settledOf(t)));
  const lists: Record<Show, TestRow[]> = { all, failed: only("fail", "probable"), input: only("input"), passed: only("pass"), waiting: only("never") };
  const counts: Record<Show, number> = { all: all.length + untested.length, failed: lists.failed.length, input: lists.input.length, passed: lists.passed.length, waiting: lists.waiting.length + untested.length };
  // A filter that has emptied since the link was made falls back to everything.
  const wanted = SHOWS.find((x) => x === query.show);
  const showing: Show = wanted && counts[wanted] > 0 ? wanted : "all";
  const listed = lists[showing];
  const host = hostFromUrl(app.url);

  const state = pass?.state ?? undefined;
  // A saved test no run has said anything about keeps its line under Suggested, with what its run is doing now.
  const added = new Map<string, Added>(
    unrun.map((t) => {
      const read = reads.get(t.id)!;
      return [t.name, { testId: t.id, active: read.active, settled: read.settled, why: read.ours ? OUR_ERROR : undefined }];
    }),
  );
  const suggested = suggestedTests(pass, new Set(tests.map((t) => t.name)), added);
  const tried = state ? triedLines(state) : [];
  const checks = tried.length;
  const explored = Boolean(state && (state.suggested.length > 0 || state.checks.length > 0 || state.bugs.length > 0));
  // Still looking around: nothing is listed yet, so the page shows the shape of what is coming.
  const looking = exploring && !explored;
  // Links from before the tabs had these names still land in the right place.
  const asked = query.tab === "tried" ? "checks" : query.show === "bugs" ? "bugs" : query.tab;
  const tabbed = Boolean(pass) || bugs.length > 0 || found.setAside.length > 0;
  const tab: Tab = pass && asked === "checks" ? "checks" : tabbed && asked === "bugs" ? "bugs" : "tests";
  const grid = tab === "tests" && query.view === "grid" && proved.length > 0;
  const fromTest = bugs.filter((b) => b.byTest).length;
  const from: From | undefined = fromTest > 0 && fromTest < bugs.length ? (["test", "check"] as const).find((f) => f === query.from) : undefined;
  const shownBugs = from ? bugs.filter((b) => b.byTest === (from === "test")) : bugs;

  const activeIds = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
  const anyActive = tests.some((t) => isActive(reads.get(t.id)!));
  const lastRun = [...latest.values()]
    .map((r) => r.finishedAt)
    .filter((d) => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const setupFailed = app.setup ? lastSetup(app.setup.steps.map((s) => s.text), [...latest.values()])?.failed : false;
  const cardProps = (t: TestRow): TestCardProps => {
    const bug = bugs.find((b) => b.test === t && b.confirmed);
    return { appId, test: t, read: reads.get(t.id)!, run: settled.get(t.id) ?? latest.get(t.id), live: latest.get(t.id), signs: walletUse(t.steps) === "signs", signing: signingFor(t), hasConditions: conditionsOf(t).length > 0, found: bug && { name: bug.name, href: bugHref(bug.id) } };
  };
  const branches = (t: TestRow) => conditionsOf(t).length > 0 && <ConditionBranches appId={appId} tests={conditionsOf(t)} reads={reads} runs={settled} className="relative z-10" />;
  // What the Add test questions can offer: pages to start on, tests to write from, and what setup already does.
  const adding: AddTestProps = { appId, pages: app.map?.pages, tests: roots.filter((t) => !t.drafting).map((t) => ({ id: t.id, name: t.name })), setup: app.setup?.steps.map((s) => s.text) };
  const nothing = listed.length === 0 && !((showing === "all" || showing === "waiting") && untested.length > 0);
  const any = counts.all > 0;

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
            rollup={!exploring && (listedTests.length > 0 || confirmedBugs > 0) ? overall : undefined}
            checked={checks > 0 || checkBugs > 0 ? { checks, bugs: checkBugs } : undefined}
            running={activeIds.length}
            runs={history}
            action={
              !exploring &&
              (tests.length > 0 || explored) && (
                <div className="flex items-center gap-2">
                  <AddTestButton {...adding} />
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

          {pass && exploring && <PassBand view={liveView(pass, app.url)} counts={{ tests: counts.all, checks: tried.length, bugs: confirmedBugs }} />}
          {pass && notice && <PassNotice pass={pass} appId={appId} suggested={suggested.length} />}

          {tests.length > 0 || explored || looking ? (
            <div className="flex flex-col gap-6">
              {tabbed && <Tabs appId={appId} tab={tab} tests={counts.all} checks={pass ? tried.length : undefined} bugs={confirmedBugs} />}
              {tab === "checks" && <Tried appId={appId} lines={tried} kind={KINDS.find((k) => k === query.kind)} tests={new Map(tests.map((t) => [t.name, t.id]))} running={exploring} />}
              {tab === "bugs" && (
                <div className="flex flex-col gap-3">
                  <TestList filter={fromTest > 0 && fromTest < bugs.length && <BugFilter appId={appId} from={from} test={fromTest} check={bugs.length - fromTest} />}>
                    {shownBugs.map((b) =>
                      b.explored ? (
                        <ExploredBug key={b.id} {...b.explored} appId={appId} appUrl={app.url} linked={b.test && { id: b.test.id, name: b.test.name }} byTest={b.byTest} open={query.bug === b.id} />
                      ) : (
                        b.test && b.look && <TestBug key={b.id} appId={appId} test={{ id: b.test.id, name: b.test.name }} look={b.look} expected={b.test.expected} failure={settled.get(b.test.id)?.result?.failure} open={query.bug === b.id} />
                      ),
                    )}
                    {bugs.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{exploring ? "No bugs so far." : "No bugs."}</li>}
                  </TestList>
                  <SetAside bugs={found.setAside} />
                </div>
              )}
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
                  ) : notice && !any ? null : (
                    <div className="flex flex-col gap-3">
                      <TestList filter={any && <TestFilter appId={appId} showing={showing} counts={counts} conditions={tests.some((t) => t.baseId)} />}>
                        {listed.map((t) => (
                          <TestLine key={t.id} {...cardProps(t)}>
                            {branches(t)}
                          </TestLine>
                        ))}
                        {(showing === "all" || showing === "waiting") && untested.map((t) => <DraftLine key={t.id} appId={appId} test={t} />)}
                        {nothing && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{exploring ? "A test shows here once it passes on a clean fork." : "No tests yet."}</li>}
                      </TestList>
                    </div>
                  )}
                  {!grid && pass && (looking ? <SuggestedPlaceholder /> : <Suggested appId={appId} tests={suggested} passId={pass.id} running={exploring} />)}
                </div>
              )}
            </div>
          ) : (
            <section className="flex flex-col items-start gap-4">
              {!pass && (
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2">
                    <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Explore {host}</h2>
                    <p className="text-base text-muted-foreground">We use the app like a person would. You get three things back.</p>
                  </div>
                  <Outcomes />
                </div>
              )}
              <div className="flex items-center gap-2">
                {!pass && (
                  <form action={exploreAction.bind(null, appId)}>
                    <Button type="submit">Explore the app</Button>
                  </form>
                )}
                <AddTestButton {...adding} label="Add a test" />
              </div>
            </section>
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

const FILTERS: { show: Show; label: string; tone?: string }[] = [
  { show: "all", label: "All" },
  { show: "failed", label: "Failed", tone: "text-bad" },
  { show: "input", label: "Needs your input", tone: "text-warn" },
  { show: "passed", label: "Passed" },
  { show: "waiting", label: "Not run yet" },
];

const CHIP = "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chip = (on: boolean) => cx(CHIP, on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground");

/** The list's own header. Worst comes first anyway, so this is for narrowing down, and it only offers what's there. */
function TestFilter({ appId, showing, counts, conditions }: { appId: string; showing: Show; counts: Record<Show, number>; conditions: boolean }) {
  return (
    <nav aria-label="Filter tests" className="flex flex-wrap items-center gap-0.5 p-1.5">
      {FILTERS.filter((f) => f.show === "all" || counts[f.show] > 0).map(({ show, label, tone }) => (
        <Link key={show} href={show === "all" ? `/apps/${appId}` : `/apps/${appId}?show=${show}`} scroll={false} aria-current={show === showing ? "true" : undefined} className={chip(show === showing)}>
          {label}
          {show !== "all" && <span className={cx("font-normal tabular-nums", tone ?? "text-muted-foreground")}>{counts[show]}</span>}
        </Link>
      ))}
      {conditions && (
        <Link href={`/apps/${appId}?view=grid`} scroll={false} className={cx(CHIP, "ml-auto text-muted-foreground hover:text-foreground")}>
          <GitFork className="size-3.5 text-fork" aria-hidden="true" />
          By condition
        </Link>
      )}
    </nav>
  );
}

/** Narrows the bugs to where they came from. Only shown when there are both kinds. */
function BugFilter({ appId, from, test, check }: { appId: string; from?: From; test: number; check: number }) {
  const item = (to: From | undefined, label: string, n?: number) => (
    <Link href={`/apps/${appId}?tab=bugs${to ? `&from=${to}` : ""}`} scroll={false} aria-current={to === from ? "true" : undefined} className={chip(to === from)}>
      {label}
      {n !== undefined && <span className="font-normal text-muted-foreground tabular-nums">{n}</span>}
    </Link>
  );
  return (
    <nav aria-label="Filter bugs" className="flex flex-wrap items-center gap-0.5 p-1.5">
      {item(undefined, "All")}
      {item("test", "From a test", test)}
      {item("check", "From a check", check)}
    </nav>
  );
}

/** Tests, checks and bugs: the three things exploring gives back, each with its own list. */
function Tabs({ appId, tab, tests, checks, bugs }: { appId: string; tab: Tab; tests: number; checks?: number; bugs: number }) {
  const item = (to: Tab, n: number, tone?: string) => {
    const { icon: Icon, label } = KIND[to];
    return (
      <Link
        href={to === "tests" ? `/apps/${appId}` : `/apps/${appId}?tab=${to}`}
        scroll={false}
        aria-current={to === tab ? "page" : undefined}
        className={cx("flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", to === tab ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
      >
        <Icon className="size-4" aria-hidden="true" />
        {label}
        <span className={cx("font-normal tabular-nums", (n > 0 && tone) || "text-muted-foreground")}>{n}</span>
      </Link>
    );
  };
  return (
    <nav aria-label="View" className="flex w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {item("tests", tests)}
      {checks !== undefined && item("checks", checks)}
      {item("bugs", bugs, "text-bad")}
    </nav>
  );
}
