import { chainInfo, chainName, formatUnitsPlain, type ChainConfig } from "@dappdrill/core";
import { appTests, db, latestRuns, makes, runHistory, settledRuns } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { CircleDashed, ListChecks, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { AppActions } from "@/components/tests/app-actions";
import { AppHero, type LiveChain, type Rollup } from "@/components/tests/app-hero";
import { HISTORY_DAYS } from "@/components/tests/app-stats";
import { DismissGoal } from "@/components/tests/goal-actions";
import { GoalList, MakeBand } from "@/components/tests/make-band";
import { SetupStuckNotice } from "@/components/tests/setup-stuck";
import { StartBand } from "@/components/tests/start-band";
import { readTest } from "@/components/tests/status";
import { TestLine, TestList } from "@/components/tests/test-card";
import { SectionHead, Tile } from "@/components/tests/tile";
import { plainError, plural } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readBalance } from "@/lib/rpc";
import { readSite } from "@/lib/site";
import { requireApp } from "@/lib/session";

/** A goal without a test has a page of its own: why, what was tried, and what we need to know. */
const goalHref = (appId: string, { makeId, index }: { makeId: string; index: number }) => `/apps/${appId}/goals/${makeId}/${index + 1}`;

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app, user, role } = await requireApp(appId);
  const [recent, tests] = await Promise.all([db().select().from(makes).where(eq(makes.appId, appId)).orderBy(desc(makes.createdAt)).limit(20), appTests(db(), appId)]);
  const [make] = recent;
  const ids = tests.map((t) => t.id);
  const [latest, settled, history] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids), runHistory(db(), appId, new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000))]);
  const reads = new Map(tests.map((t) => [t.id, readTest(latest.get(t.id), settled.get(t.id))]));

  // Makes go one at a time: the one going, or the next in line, is shown, and the tests waiting after it are listed under it.
  const active = recent.filter((m) => m.status === "queued" || m.status === "running").reverse();
  const making = active.find((m) => m.status === "running") ?? active[0];
  const next = active.filter((m) => m !== making);
  // The app's first tests: nothing to report yet, so the page says what is happening and how long it takes.
  const first = Boolean(making && !making.goal && tests.length === 0);
  // The tests the running make has kept so far, listed first and marked New when there are older ones to tell them from.
  const kept = new Set(making?.state.goals.flatMap((g) => (g.status === "kept" && g.testId ? [g.testId] : [])));
  const fresh = kept.size < tests.length ? kept : new Set<string>();
  const activeIds = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);

  const by = (outcome: string) => tests.filter((t) => reads.get(t.id)!.settled === outcome).length;
  const rollup: Rollup = { total: tests.length, passed: by("passed"), failed: by("failed"), unverified: by("unverified"), notRun: by("never") };
  const lastRun = [...settled.values()].reduce<Date | undefined>((at, r) => (r.finishedAt && (!at || r.finishedAt > at) ? r.finishedAt : at), undefined);

  // Tests on a chain we can't fork run on the real one, and the owner should know what that leaves behind, and what pays for it.
  const liveChain = [...app.settings.chains, ...app.chains].find((c) => c.mode === "live");
  const live = liveChain && { ...(await liveWallet(liveChain, app.liveKeyAddress)), funding: Boolean(app.settings.funding) };

  const manage = can(role, "apps.manage");
  // What the makes since tests were last made for the whole app left without a test, and why, until each is tried again or dismissed.
  const since = recent.slice(0, recent.findIndex((m) => !m.goal) + 1 || recent.length);
  const notKept = (making ? [making] : since).flatMap((m) => m.state.goals.flatMap((goal, index) => (goal.status === "not-kept" && !goal.dismissed ? [{ goal, ref: { makeId: m.id, index } }] : [])));
  // The setup didn't finish: said once, in parts, in place of the plainer notices below.
  const stuck = !making && make?.status === "done" ? make.state.stuck : undefined;
  const stoppedEarly = !making && make && !stuck && (make.status === "failed" || (make.status === "done" && make.state.goals.length === 0 && !make.goal));

  const testList = (
    <TestList>
      {[...tests]
        .sort((a, b) => Number(kept.has(b.id)) - Number(kept.has(a.id)))
        .map((t) => (
          <TestLine key={t.id} appId={appId} test={t} read={reads.get(t.id)!} run={settled.get(t.id) ?? latest.get(t.id)} live={latest.get(t.id)} fresh={fresh.has(t.id)} />
        ))}
    </TestList>
  );

  return (
    <div className="page">
      {(making || activeIds.length > 0) && <AutoRefresh every={2000} />}

      <div className="flex flex-col gap-12">
        <AppHero
          appId={appId}
          name={app.name}
          url={app.url}
          lastRun={lastRun}
          wallet={app.settings.wallets[0]}
          chainId={(app.settings.chains[0] ?? app.chains[0])?.id}
          live={live}
          rollup={tests.length > 0 ? rollup : undefined}
          running={activeIds.length}
          runs={history}
          action={!first && (tests.length > 0 || make) && <AppActions appId={appId} appUrl={app.url} tests={tests.length} running={activeIds.length > 0} making={Boolean(making)} canMake={manage} />}
        />

        {making && <MakeBand appId={appId} appUrl={app.url} make={making} next={next} wait={first ? { email: making.requestedBy === user.id ? user.email : undefined } : undefined} />}

        {stuck && make && (
          <SetupStuckNotice appId={appId} stuck={stuck} kept={make.state.goals.filter((g) => g.status === "kept").length} left={make.state.goals.filter((g) => g.status === "waiting").length} chain={live?.name} canMake={manage} />
        )}

        {stoppedEarly && make && (
          <div role="status" className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
            <Tile icon={TriangleAlert} tint="warn" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">{make.status === "failed" ? "Making tests stopped early" : "We found nothing to test"}</p>
              <p className="text-pretty text-muted-foreground">
                {make.status === "failed" ? (make.error ? plainError(make.error, app.url) : "Something went wrong on our side.") : (make.state.why ?? "The app showed nothing a user could do.")}
              </p>
            </div>
          </div>
        )}

        {making ? (
          <section aria-label="Tests" className="flex flex-col gap-4">
            <SectionHead
              icon={ListChecks}
              tint="good"
              title="Tests"
              detail={tests.length === 0 ? "None kept yet. Each one shows here as soon as it is." : fresh.size > 0 ? `${plural(tests.length, "test")}, ${fresh.size} kept just now.` : `${plural(tests.length, "test")} kept so far.`}
            />
            {tests.length > 0 && testList}
          </section>
        ) : tests.length > 0 ? (
          testList
        ) : (
          !make && <StartBand appId={appId} url={app.url} site={(await readSite(app.url)) ?? { url: app.url, framable: false }} wallet={app.settings.wallets[0]} chainId={(app.settings.chains[0] ?? app.chains[0])?.id} live={live?.name} />
        )}

        {notKept.length > 0 && (
          <section aria-label="Goals without a test" className="flex flex-col gap-4">
            <SectionHead
              icon={CircleDashed}
              tint="quiet"
              title={`${plural(notKept.length, "goal")} without a test`}
              detail={making ? "Tried, and no test was kept. Each says why, and can be tried again once these tests are made." : "Tried, and no test was kept. Open one to see why and tell us what we need to know."}
            />
            <div className="rounded-xl border border-dashed p-1.5">
              <GoalList
                appId={appId}
                goals={notKept.map((n) => n.goal)}
                href={making ? undefined : (_, i) => goalHref(appId, notKept[i]!.ref)}
                aside={making ? undefined : (_, i) => <DismissGoal key={`${notKept[i]!.ref.makeId}:${notKept[i]!.ref.index}`} appId={appId} goal={notKept[i]!.ref} />}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** The live chain's name and the funded wallet with what it holds, read from the chain's RPC when it answers in time. */
async function liveWallet(chain: ChainConfig, address: string | null): Promise<LiveChain> {
  const name = chainName(chain.id);
  if (!address) return { name };
  const wei = await readBalance(chain.rpcUrl, address);
  const balance = wei === undefined ? undefined : `${formatUnitsPlain(wei, 18, 4)} ${chainInfo(chain.id)?.nativeSymbol ?? ""}`.trim();
  return { name, wallet: { address, balance } };
}
