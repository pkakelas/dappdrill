import { chainInfo, chainName, formatUnitsPlain, type ChainConfig } from "@dappdrill/core";
import { appTests, db, latestRuns, makes, runHistory, settledRuns } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { makeTestsAction } from "@/actions/tests";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/submit-button";
import { AddTestButton } from "@/components/tests/add-test";
import { AppActions } from "@/components/tests/app-actions";
import { AppHero, type LiveChain, type Rollup } from "@/components/tests/app-hero";
import { HISTORY_DAYS } from "@/components/tests/app-stats";
import { GoalList, MakeBand } from "@/components/tests/make-band";
import { SetupStuckNotice } from "@/components/tests/setup-stuck";
import { readTest } from "@/components/tests/status";
import { TestLine, TestList } from "@/components/tests/test-card";
import { Tile } from "@/components/tests/tile";
import { hostFromUrl, plainError, plural } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readBalance } from "@/lib/rpc";
import { requireApp } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { app } = await requireApp((await params).appId);
  return { title: app.name };
}

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app, user, role } = await requireApp(appId);
  const [[make], tests] = await Promise.all([db().select().from(makes).where(eq(makes.appId, appId)).orderBy(desc(makes.createdAt)).limit(1), appTests(db(), appId)]);
  const ids = tests.map((t) => t.id);
  const [latest, settled, history] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids), runHistory(db(), appId, new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000))]);
  const reads = new Map(tests.map((t) => [t.id, readTest(latest.get(t.id), settled.get(t.id))]));

  const making = make && (make.status === "queued" || make.status === "running") ? make : undefined;
  // The app's first tests: nothing to report yet, so the page says what is happening and how long it takes.
  const first = Boolean(making && !making.goal && tests.length === 0);
  const activeIds = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);

  const by = (outcome: string) => tests.filter((t) => reads.get(t.id)!.settled === outcome).length;
  const rollup: Rollup = { total: tests.length, passed: by("passed"), failed: by("failed"), unverified: by("unverified"), notRun: by("never") };
  const lastRun = [...settled.values()].reduce<Date | undefined>((at, r) => (r.finishedAt && (!at || r.finishedAt > at) ? r.finishedAt : at), undefined);

  // Tests on a chain we can't fork run on the real one, and the owner should know what that leaves behind, and what pays for it.
  const liveChain = [...app.settings.chains, ...app.chains].find((c) => c.mode === "live");
  const live = liveChain && { ...(await liveWallet(liveChain, app.liveKeyAddress)), funding: Boolean(app.settings.funding) };

  const manage = can(role, "apps.manage");
  // What the last make left without a test, and why. Shown until tests are made again.
  const notKept = !making && make ? make.state.goals.filter((g) => g.status === "not-kept") : [];
  // The setup didn't finish: said once, in parts, in place of the plainer notices below.
  const stuck = !making && make?.status === "done" ? make.state.stuck : undefined;
  const stoppedEarly = !making && make && !stuck && (make.status === "failed" || (make.status === "done" && make.state.goals.length === 0 && !make.goal));

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
          writing={first ? { email: making?.requestedBy === user.id ? user.email : undefined } : undefined}
          action={!first && (tests.length > 0 || make) && <AppActions appId={appId} appUrl={app.url} tests={tests.length} running={activeIds.length > 0} making={Boolean(making)} canMake={manage} />}
        />

        {making && <MakeBand appId={appId} appUrl={app.url} make={making} />}

        {stuck && make && (
          <SetupStuckNotice
            appId={appId}
            stuck={stuck}
            kept={make.state.goals.filter((g) => g.status === "kept").length}
            left={make.state.goals.filter((g) => g.status === "waiting").length}
            chain={live?.name}
            canMake={manage}
          />
        )}

        {stoppedEarly && make && (
          <div role="status" className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
            <Tile icon={TriangleAlert} tint="warn" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">{make.status === "failed" ? "Making tests stopped early" : "We found nothing to test"}</p>
              <p className="text-pretty text-muted-foreground">{make.status === "failed" ? (make.error ? plainError(make.error, app.url) : "Something went wrong on our side.") : (make.state.why ?? "The app showed nothing a user could do.")}</p>
            </div>
          </div>
        )}

        {tests.length > 0 ? (
          <TestList>
            {tests.map((t) => (
              <TestLine key={t.id} appId={appId} test={t} read={reads.get(t.id)!} run={settled.get(t.id) ?? latest.get(t.id)} live={latest.get(t.id)} />
            ))}
          </TestList>
        ) : (
          !make && (
            <section className="flex flex-col items-start gap-6">
              <div className="flex flex-col gap-2">
                <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Make tests for {hostFromUrl(app.url)}</h2>
                <p className="max-w-prose text-base text-pretty text-muted-foreground">We look over the app, pick what a user would do there, and turn each into a test by doing it. A test is kept once it goes the same way twice in a row.</p>
              </div>
              <div className="flex items-center gap-2">
                <form action={makeTestsAction.bind(null, appId)}>
                  <SubmitButton busy="Starting…">Make tests</SubmitButton>
                </form>
                <AddTestButton appId={appId} label="Add a test" />
              </div>
            </section>
          )
        )}

        {notKept.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">{plural(notKept.length, "goal")} without a test</h2>
              <p className="text-sm text-pretty text-muted-foreground">Tried the last time tests were made, and no test was kept. Each says why.</p>
            </div>
            <div className="rounded-xl border bg-card p-1.5 shadow-sm">
              <GoalList appId={appId} goals={notKept} />
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
