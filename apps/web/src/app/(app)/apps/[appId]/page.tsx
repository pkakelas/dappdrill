import { chainInfo, chainName, formatUnitsPlain, type ChainConfig } from "@dappdrill/core";
import { accountOf, appTests, db, latestRuns, makes, recentOutcomes, settledRuns } from "@dappdrill/db";
import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { makeTestsAction } from "@/actions/tests";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { AddTest } from "@/components/tests/add-test";
import { AppActions } from "@/components/tests/app-actions";
import { AppHeader, type TestAccount } from "@/components/tests/app-header";
import { GoalNeed, LostNeed } from "@/components/tests/goal-actions";
import { Need, NeedsYou } from "@/components/tests/needs-you";
import { RepairButton } from "@/components/tests/repair-button";
import { Start } from "@/components/tests/start";
import { readTest } from "@/components/tests/status";
import { makingItem, standsAs, STANDS_ORDER, testItem } from "@/components/tests/test-item";
import { TestList } from "@/components/tests/test-list";
import { MakeWork, RepairWork, type RepairRow } from "@/components/tests/working";
import { OUR_SIDE, plainError, plural, timeAgo } from "@/lib/format";
import { isCode } from "@/lib/lines";
import { can } from "@/lib/permissions";
import { readBalance } from "@/lib/rpc";
import { readSite } from "@/lib/site";
import { requireApp, type App } from "@/lib/session";
import { startChoices } from "@/lib/starts";

/** The tab's title says where the work is, for someone who left the page open and went elsewhere. */
export async function generateMetadata({ params }: { params: Promise<{ appId: string }> }): Promise<Metadata> {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const [working] = await db()
    .select({ goal: makes.goal, state: makes.state })
    .from(makes)
    .where(and(eq(makes.appId, appId), eq(makes.status, "running")))
    .limit(1);
  return { title: working ? `${workingOn(working)} · ${app.name}` : app.name };
}

function workingOn({ goal, state }: Pick<typeof makes.$inferSelect, "goal" | "state">): string {
  if (state.repair) return `Repairing, ${state.repair.tests.filter((t) => t.status === "repaired" || t.status === "not-repaired").length} of ${state.repair.tests.length} done`;
  if (goal) return "Generating a test";
  if (state.stage === "looking") return "Exploring";
  return `Generating, ${state.goals.filter((g) => g.status === "kept" || g.status === "not-kept").length} of ${state.goals.length} done`;
}

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app, user, role } = await requireApp(appId);
  const [rows, tests] = await Promise.all([db().select().from(makes).where(eq(makes.appId, appId)).orderBy(desc(makes.createdAt)).limit(20), appTests(db(), appId)]);
  // A repair is kept beside the makes, and shown where a make is.
  const repairs = rows.filter((m): m is RepairRow => Boolean(m.state.repair));
  const recent = rows.filter((m) => !m.state.repair);
  const [make] = recent;
  const ids = tests.map((t) => t.id);
  const [latest, settled, outcomes] = await Promise.all([latestRuns(db(), ids), settledRuns(db(), ids), recentOutcomes(db(), ids)]);
  const reads = new Map(tests.map((t) => [t.id, readTest(latest.get(t.id), settled.get(t.id))]));
  const stands = new Map(tests.map((t) => [t.id, standsAs(t, reads.get(t.id)!, settled.get(t.id))]));

  // Makes go one at a time: the one going, or the next in line, is shown, and the tests waiting after it are listed under it.
  const active = recent.filter((m) => m.status === "queued" || m.status === "running").reverse();
  const making = active.find((m) => m.status === "running") ?? active[0];
  const next = active.filter((m) => m !== making);
  // An app's tests generated from exploring it take the top of the page. A test added by hand is a line of the list while it is generated, with those waiting after it.
  const whole = making && !making.goal ? making : undefined;
  const adding = making && !whole ? [making, ...next] : [];
  // The app's first tests: nothing to report yet, so the page says what is happening and how long it takes.
  const first = Boolean(making && !making.goal && tests.length === 0);
  // The tests ready so far from what is being generated, listed first and marked New when there are older ones to tell them from.
  const ready = new Set(making?.state.goals.flatMap((g) => (g.status === "kept" && g.testId ? [g.testId] : [])));
  const fresh = ready.size < tests.length ? ready : new Set<string>();
  const activeIds = tests.filter((t) => reads.get(t.id)!.active).map((t) => t.id);
  const repairing = repairs.find((m) => m.status === "queued" || m.status === "running");
  const busy = Boolean(making || repairing);

  const broken = tests.filter((t) => stands.get(t.id) === "repair").length;
  const lastRun = [...settled.values()].reduce<Date | undefined>((at, r) => (r.finishedAt && (!at || r.finishedAt > at) ? r.finishedAt : at), undefined);
  const listed = [...tests].sort((a, b) => Number(ready.has(b.id)) - Number(ready.has(a.id)) || STANDS_ORDER.indexOf(stands.get(a.id)!) - STANDS_ORDER.indexOf(stands.get(b.id)!));

  // Runs spend what the app's own account holds, so the owner should see which it is and what is left on it.
  // The chains a run starts with: the ones the owner named and those the app asked the wallet for, or all it was seen to use.
  const { chains: named } = app.settings;
  const used = (named.length ? [...named, ...app.chains.filter((c) => c.fromApp && !named.some((n) => n.id === c.id))] : app.chains).filter((c) => !c.fallback);
  // Explored, and the app asked for no chain: Ethereum was our own guess, so it isn't shown as the app's.
  const chainUnseen = used.length === 0 && app.chains.length > 0;
  const chain = used[0];
  const account = app.liveKeyAddress ? await testAccount(app, app.liveKeyAddress, chain) : undefined;
  const manage = can(role, "apps.manage");

  // What waits for the owner, once nothing is being worked on that could change it.
  // The setup didn't finish: said once, in place of the plainer notice that generating stopped.
  const stuck = !making && make?.status === "done" ? make.state.stuck : undefined;
  // A failure of our own workings while the app was explored asks nothing of the owner: with tests on the page it isn't said, and with none it is the way to generate again.
  // A test the owner added is theirs to try again, and is said further down.
  const failed = make?.status === "failed" ? (make.error ? plainError(make.error, app.url) : OUR_SIDE) : undefined;
  const stopped = !making && make && !stuck && (failed ? !make.goal && (failed !== OUR_SIDE || tests.length === 0) : make.status === "done" && !make.goal && (make.state.goals.length === 0 || Boolean(make.state.why)));
  // The site's bot check turned us away, which is not the same as an app with nothing to test: the engine says so with this word.
  const botCheck = stopped && make.status === "done" ? /^Blocked: (.+)$/s.exec(make.state.why ?? "")?.[1] : undefined;
  // What a run can't do as it is. We repair these ourselves after a run; what is left here is what that couldn't.
  const startUnwritten = ![...(app.suite.setup?.steps ?? []), ...(accountOf(app) === "kept" ? (app.suite.reset?.steps ?? []) : [])].every(isCode);
  const toRepair = !busy && tests.length > 0 && (broken > 0 || startUnwritten);
  const [lastRepair] = repairs;
  const notRepaired = toRepair && lastRepair ? lastRepair.state.repair.tests.filter((t) => t.status === "not-repaired" && stands.get(t.testId) === "repair") : [];
  // What the tests generated since the app was last explored left without a test, until each is tried again or dismissed.
  const since = recent.slice(0, recent.findIndex((m) => !m.goal) + 1 || recent.length);
  const open = (making ? [making] : since).flatMap((m) =>
    m.state.goals.flatMap((g, index) => (g.status === "not-kept" && !g.dismissed ? [{ goal: g.goal, ask: g.tried?.ask, why: g.whyNot, ref: { makeId: m.id, index }, href: `/apps/${appId}/goals/${m.id}/${index + 1}` }] : [])),
  );
  // A test added by hand whose generating broke before anything came of it, until it is tried again or dismissed.
  const lost = since.filter((m) => m.goal && m.status === "failed" && !m.state.dismissed);
  // A question comes first. Goals that wait on one question, or stopped for one reason, are one item.
  const grouped = new Map<string, typeof open>();
  for (const g of open) {
    const key = g.ask ? `ask:${g.ask}` : g.why ? `why:${g.why}` : `${g.ref.makeId}:${g.ref.index}`;
    grouped.set(key, [...(grouped.get(key) ?? []), g]);
  }
  const goalNeeds = [...grouped].map(([key, goals]) => ({ key, goals, ask: goals[0]!.ask, why: goals.every((g) => g.why === goals[0]!.why) ? goals[0]!.why : undefined })).sort((a, b) => Number(Boolean(b.ask)) - Number(Boolean(a.ask)));
  const needs = Number(Boolean(stuck)) + Number(Boolean(stopped)) + Number(toRepair) + lost.length + goalNeeds.length;

  // Generating didn't get going, so the way on is to generate again: said beside what stopped it, in the words the header uses.
  const halted = Boolean(stuck || stopped);
  const generate = manage && (
    <form action={makeTestsAction.bind(null, appId)}>
      <SubmitButton variant="outline" size="sm" busy="Starting…">
        Generate tests
      </SubmitButton>
    </form>
  );

  return (
    <div className="page">
      {(busy || activeIds.length > 0) && <AutoRefresh every={2000} />}

      <div className="flex flex-col gap-10">
        <AppHeader
          appId={appId}
          name={app.name}
          url={app.url}
          wallet={app.settings.wallets[0]}
          chains={used.map((c) => c.id)}
          chainUnseen={chainUnseen}
          account={account}
          action={(tests.length > 0 || (make && !halted)) && <AppActions appId={appId} appUrl={app.url} tests={tests.length} running={activeIds.length > 0} making={Boolean(making)} canMake={manage} />}
        />

        {whole && <MakeWork appUrl={app.url} make={whole} next={next} first={first} email={whole.requestedBy === user.id ? user.email : undefined} />}
        {repairing && <RepairWork appId={appId} appUrl={app.url} repair={repairing} />}

        {needs > 0 && (
          <NeedsYou count={needs} note={making ? "You can answer once the tests are generated" : undefined}>
            {stuck && (
              <Need
                title={stuck.fix === "funds" ? `The test account has too little${chain ? ` on ${chainName(chain.id)}` : ""}` : stuck.line ? "We couldn't get past the setup" : "The app wouldn't let us in"}
                actions={
                  <>
                    <Button asChild size="sm">
                      <Link href={`/apps/${appId}/settings#${stuck.fix === "funds" ? "account" : "setup"}`}>{stuck.fix === "funds" ? "Open the account" : "Open the setup"}</Link>
                    </Button>
                    {generate}
                  </>
                }
              >
                <p className="text-foreground">{stuck.reason}</p>
                {stuck.fix !== "funds" && stuck.sentence && <p className="line-clamp-2">It stopped at “{stuck.sentence}”.</p>}
                <p>
                  {stuck.fix === "funds"
                    ? "Every test starts with the setup. Send the account what it needs, or use a key that holds funds, then generate the tests."
                    : "Every test starts with the setup. Check its steps, or add a note on how to get in, then generate the tests."}
                </p>
              </Need>
            )}

            {botCheck && (
              <Need
                title="Your site's bot check stopped us"
                actions={
                  <>
                    {manage && (
                      <Button asChild size="sm">
                        <Link href={`/apps/${appId}/settings#access`}>Open bot protection</Link>
                      </Button>
                    )}
                    {generate}
                  </>
                }
              >
                <p className="text-foreground">{botCheck}</p>
                <p>We never solve a bot check, so nothing was tried. Let us in with a header your firewall allows, then generate the tests.</p>
              </Need>
            )}

            {stopped && make && !botCheck && (
              <Need title={make.status === "done" && make.state.goals.length === 0 ? "We found nothing to test" : "Generating tests stopped early"} actions={generate}>
                <p>{failed ?? make.state.why ?? "The app showed nothing a user could do."}</p>
              </Need>
            )}

            {toRepair && (
              <Need
                title={broken > 0 ? `${plural(broken, "test")} can't run until ${broken === 1 ? "it is" : "they're"} repaired` : "No test can run until the setup is repaired"}
                actions={<RepairButton appId={appId} label="Repair" />}
                below={
                  notRepaired.length > 0 && (
                    <ul className="flex max-w-3xl flex-col gap-2 border-l-2 pl-3.5 text-sm">
                      {notRepaired.map((t) => (
                        <li key={t.testId} className="flex flex-col">
                          <Link href={`/apps/${appId}/tests/${t.testId}`} className="w-fit font-medium hover:underline hover:underline-offset-4">
                            {t.name}
                          </Link>
                          {t.why && <span className="line-clamp-2 text-pretty text-muted-foreground">{t.why}</span>}
                        </li>
                      ))}
                    </ul>
                  )
                }
              >
                <p>
                  {broken > 0 ? "Your app changed, or a step was edited, so a recorded step no longer fits the page." : "A step every test starts with isn't recorded yet."} A repair does the steps in the browser again, records them, and runs the
                  tests once.{notRepaired.length > 0 && " The last repair couldn't fix these:"}
                </p>
              </Need>
            )}

            {lost.map((m) => (
              <LostNeed key={m.id} makeId={m.id} name={makingItem(m).name} why={m.error ? plainError(m.error, app.url) : OUR_SIDE} />
            ))}

            {goalNeeds.map((n) => (
              <GoalNeed key={n.key} appId={appId} goals={n.goals} ask={n.ask} why={n.why} locked={Boolean(making)} />
            ))}
          </NeedsYou>
        )}

        {tests.length > 0 || (make && !whole) ? (
          <TestList
            appId={appId}
            appUrl={app.url}
            items={listed.map((t) => testItem({ test: t, read: reads.get(t.id)!, stands: stands.get(t.id)!, settled: settled.get(t.id), latest: latest.get(t.id), recent: outcomes.get(t.id) ?? [], fresh: fresh.has(t.id) }))}
            making={adding.map(makingItem)}
            now={Date.now()}
            lastRun={lastRun && timeAgo(lastRun)}
            fresh={fresh.size}
            add={<AddTest appId={appId} starts={startChoices(app)} box />}
          />
        ) : (
          !make && <Start appId={appId} url={app.url} site={(await readSite(app.url)) ?? { url: app.url, framable: false }} wallet={app.settings.wallets[0]} chainId={chain?.id} canMake={manage} starts={startChoices(app)} />
        )}
      </div>
    </div>
  );
}

/** The app's own account and what it holds on the app's first chain, read from the chain's RPC when it answers in time. */
async function testAccount(app: App, address: string, chain?: ChainConfig): Promise<TestAccount> {
  const account = { kept: accountOf(app) === "kept", address };
  if (!chain) return account;
  const wei = await readBalance(chain.rpcUrl, address);
  const balance = wei === undefined ? undefined : `${formatUnitsPlain(wei, 18, 4)} ${chainInfo(chain.id)?.nativeSymbol ?? ""}`.trim();
  return { ...account, balance };
}
