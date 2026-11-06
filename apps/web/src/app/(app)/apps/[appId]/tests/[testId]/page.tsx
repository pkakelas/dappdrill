import { briefGoal, conditionInfo, formatDuration, oursBroke, SETUP_WHEN_LABEL, signingOf, stepSigns, walletUse, type AppSetup, type SecondLook, type SetupRunResult, type TestRunResult, type TestStep } from "@dappdrill/core";
import { db, latestRuns, notWritten, settledRuns, specOf, testRuns, tests, type TestRunRow } from "@dappdrill/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { Check, Wallet, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTestAction } from "@/actions/tests";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { LookReport } from "@/components/explore/bugs";
import { ConditionFork } from "@/components/tests/condition-branches";
import { AddConditions } from "@/components/tests/conditions";
import { Duplicate } from "@/components/tests/duplicate";
import { RunButton } from "@/components/tests/run-button";
import { ConsoleErrors, IssueList, Panel, WalletActivity } from "@/components/tests/run-details";
import { StepList } from "@/components/tests/setup-steps";
import { SigningFlag } from "@/components/tests/signing-flag";
import { SpecEditor } from "@/components/tests/spec-editor";
import { isActive, OUR_ERROR, readLabel, readTest, STATE_LABEL, STATE_TEXT, StateMark } from "@/components/tests/status";
import { WriteTest } from "@/components/tests/write-test";
import { cx } from "@/components/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { artifactUrl } from "@/lib/artifacts";
import { timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Params = { appId: string; testId: string };

async function load(appId: string, testId: string) {
  await requireApp(appId);
  const [test] = await db()
    .select()
    .from(tests)
    .where(and(eq(tests.id, testId), eq(tests.appId, appId)));
  if (!test) notFound();
  return test;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { appId, testId } = await params;
  return { title: specOf(await load(appId, testId)).name };
}

export default async function TestPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ run?: string; add?: string }> }) {
  const { appId, testId } = await params;
  const { run: runParam, add } = await searchParams;
  const test = await load(appId, testId);
  const { app } = await requireApp(appId);
  const [[base], children, history, [forkedFrom]] = await Promise.all([
    test.baseId ? db().select().from(tests).where(eq(tests.id, test.baseId)) : Promise.resolve([]),
    test.baseId ? Promise.resolve([]) : db().select().from(tests).where(eq(tests.baseId, test.id)).orderBy(asc(tests.position)),
    db().select().from(testRuns).where(eq(testRuns.testId, test.id)).orderBy(desc(testRuns.createdAt)).limit(15),
    test.forkedFrom ? db().select({ id: tests.id, name: tests.name }).from(tests).where(eq(tests.id, test.forkedFrom)) : Promise.resolve([]),
  ]);
  const childIds = children.map((c) => c.id);
  const [childLatest, childSettled] = await Promise.all([latestRuns(db(), childIds), settledRuns(db(), childIds)]);
  const childReads = new Map(children.map((c) => [c.id, readTest(c, childLatest.get(c.id), childSettled.get(c.id))]));

  const spec = specOf(test);
  const latest = history[0];
  // The status reads from the latest finished result; a queued, running or stopped run shows beside it.
  const settled = history.find((r) => (r.status === "pass" || r.status === "fail" || r.status === "error" || r.status === "skipped") && !oursBroke(r));
  const run = (runParam && history.find((r) => r.id === runParam)) || settled || latest;
  const viewingOld = run && settled && run.id !== settled.id && run.id !== latest?.id;
  const state = readTest(test, latest, settled);
  const runState = run ? run.status : "never";
  const result = run?.result ?? undefined;
  const steps: TestStep[] = base ? base.steps : test.steps;
  const childActive = children.some((c) => isActive(childReads.get(c.id)!));
  const condition = test.condition ? conditionInfo(test.condition) : undefined;
  const signing = signingOf(result?.signingReviews.map((r) => r.verdict) ?? []);
  const wallet = walletUse(test.steps);
  const forks = !test.baseId && (
    <ConditionFork appId={appId} tests={children} reads={childReads} runs={childSettled}>
      {wallet === "signs" && <AddConditions testId={test.id} existing={children.flatMap((c) => (c.condition ? [c.condition] : []))} startOpen={add === "conditions"} />}
    </ConditionFork>
  );
  const url = (path?: string | null) => (run ? artifactUrl("runs", run.batchId, path) : null);

  return (
    <div className="page flex flex-col gap-8">
      {(isActive(state) || childActive) && <AutoRefresh every={2000} />}

      <header className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href={`/apps/${appId}`} className="hover:text-foreground">
            Tests
          </Link>
          {base && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/apps/${appId}/tests/${base.id}`} className="hover:text-foreground">
                {base.name}
              </Link>
            </>
          )}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{spec.name}</h1>
            <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1", STATE_TEXT[state.mark])}>
              <StateMark state={state.mark} />
              <span>{notWritten(test) ? "Not tested yet" : readLabel(state)}</span>
              {settled?.finishedAt && <span className="text-muted-foreground">· {timeAgo(settled.finishedAt)}</span>}
              {settled?.startedAt && settled.finishedAt && <span className="text-muted-foreground">· took {formatDuration(settled.finishedAt.getTime() - settled.startedAt.getTime())}</span>}
              <SigningFlag signing={signing} className="before:mr-2 before:content-['·'] before:text-muted-foreground" />
              {forkedFrom && (
                <span className="text-muted-foreground">
                  · duplicated from{" "}
                  <Link href={`/apps/${appId}/tests/${forkedFrom.id}`} className="underline underline-offset-4 hover:text-foreground">
                    {forkedFrom.name}
                  </Link>
                </span>
              )}
            </p>
            {state.draft && <p className="text-sm text-muted-foreground">{test.draftNote !== settled?.result?.failure && test.draftNote} It doesn&apos;t run on a schedule until it passes.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {notWritten(test) ? <WriteTest testId={test.id} primary /> : <RunButton target={{ appId, testIds: [test.id] }} active={Boolean(state.active)} stopIds={[test.id]} label="Run" size="md" primary disabled={state.drafting} />}
            {!test.baseId && !state.drafting && <Duplicate testId={test.id} />}
            <ConfirmButton className={buttonVariants({ variant: "outline", size: "sm" })} onConfirm={deleteTestAction.bind(null, test.id)}>
              Delete
            </ConfirmButton>
          </div>
        </div>
      </header>

      {test.drafting && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card px-5 py-4">
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/50" />
          <p className="text-muted-foreground">Writing this test from “{briefGoal(test.drafting).replace(/\.$/, "")}”. It runs as soon as the steps are ready.</p>
        </div>
      )}

      {viewingOld && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-5 py-3 text-muted-foreground">
          <span>
            Showing the result from {timeAgo(run.createdAt)} ({STATE_LABEL[run.status].toLowerCase()}).
          </span>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href={`/apps/${appId}/tests/${test.id}`}>Back to the latest</Link>
          </Button>
        </div>
      )}

      {result?.blame === "ours" ? (
        <div role="status" className="rounded-xl bg-muted px-5 py-4 leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">{OUR_ERROR}</strong> {result.failure}
        </div>
      ) : (
        result?.failure &&
        (runState === "fail" || runState === "error") && (
          <div
            role="status"
            className={cx("rounded-xl border px-5 py-4 leading-relaxed", runState === "fail" ? "border-bad-line bg-bad-soft text-bad-ink" : "border-warn-line bg-warn-soft text-warn-ink")}
          >
            {result.failure}
          </div>
        )
      )}
      {runState === "fail" && result?.secondLook && <Checked look={result.secondLook} checking={state.checking && run?.id === settled?.id} expected={spec.expected} failure={result.failure} />}
      {runState === "skipped" && (
        <div role="status" className="rounded-xl bg-muted px-5 py-4 leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Doesn&apos;t apply here.</strong> {result?.failure ?? "This condition can't be set up for this test."} It is left out of the counts.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {condition && base ? (
            // A condition row has nothing of its own to edit: steps and goal are the test's, name and expected the condition's.
            <div className="flex flex-col gap-6">
              <p className="rounded-xl bg-fork-bg/50 px-4 py-3 text-muted-foreground">
                Runs the steps of{" "}
                <Link href={`/apps/${appId}/tests/${base.id}`} className="underline underline-offset-4 hover:text-foreground">
                  {base.name}
                </Link>{" "}
                under the condition <strong className="font-semibold text-foreground">{condition.name}</strong>. Edit the test to change what runs.
              </p>
              <Block label="Goal">{base.goal}</Block>
              <Block label="Expected result">
                {condition.expected}
                <Verdict result={result} />
              </Block>
              {result?.setup && <SetupRun appId={appId} run={result.setup} setup={app.setup} url={url} />}
              <Steps steps={steps} result={result} url={url} />
            </div>
          ) : (
          <SpecEditor
            testId={test.id}
            spec={{ name: test.name, goal: test.goal, expected: test.expected, steps: test.steps.map((s) => s.text) }}
            stepsFixed={false}
            disabled={Boolean(test.drafting)}
            view={
              <div className="flex flex-col gap-6">
                <Block label="Goal">{test.goal || <span className="text-muted-foreground">Not written yet</span>}</Block>
                <Block label="Expected result">
                  {test.expected || <span className="text-muted-foreground">Not written yet</span>}
                  <Verdict result={result} />
                </Block>
                {result?.setup && <SetupRun appId={appId} run={result.setup} setup={app.setup} url={url} />}
                <Steps steps={steps} result={result} url={url} forks={forks} wallet={test.baseId ? undefined : wallet} hasConditions={children.length > 0} />
              </div>
            }
          />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Media run={run} result={result} url={url} />
          {result && <IssueList result={result} />}
          {result && <WalletActivity result={result} />}
          {result && <ConsoleErrors result={result} />}

          {history.length > 1 && <History appId={appId} testId={test.id} runs={history} selected={run?.id} />}
        </aside>
      </div>
    </div>
  );
}

/** What the judge or the proof check said about the expected result, under it. */
/** What the second look at a failure said: still on it, the app's bug, the test's fault, or not sure. */
function Checked({ look, checking, expected, failure }: { look: SecondLook; checking: boolean; expected: string; failure?: string }) {
  if (look.verdict === "app")
    return (
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-medium text-pretty">{look.bug?.name ?? "The app did the wrong thing"}</h2>
        <LookReport look={look} expected={expected} failure={failure} />
      </section>
    );
  if (look.verdict === "test")
    return (
      <div role="status" className="rounded-xl border border-warn-line bg-warn-soft px-5 py-4 leading-relaxed text-warn-ink">
        <strong className="font-medium">The app is fine, the test was wrong.</strong> {look.reason}
      </div>
    );
  return (
    <div role="status" className={cx("rounded-xl px-5 py-4 leading-relaxed", checking ? "bg-live-soft text-live-ink" : "bg-muted text-muted-foreground")}>
      {checking ? (
        "Checking again in a fresh browser. Nothing for you to do yet."
      ) : (
        <>
          <strong className="font-medium text-foreground">Not confirmed when checked again in a fresh browser.</strong> {look.verdict === "unsure" ? look.reason : "The check didn't report back."}
        </>
      )}
    </div>
  );
}

function Verdict({ result }: { result?: TestRunResult }) {
  if (!result?.verdict) return null;
  return (
    <span className={cx("mt-2 flex gap-2", result.verdict.ok ? "text-muted-foreground" : "text-bad")}>
      {result.verdict.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span>{result.verdict.reason}</span>
    </span>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <p className="flex flex-col leading-relaxed">{children}</p>
    </div>
  );
}

function Steps({
  steps,
  result,
  url,
  forks,
  wallet,
  hasConditions,
}: {
  steps: TestStep[];
  result?: TestRunResult;
  url: (p?: string | null) => string | null;
  forks?: React.ReactNode;
  wallet?: ReturnType<typeof walletUse>;
  hasConditions?: boolean;
}) {
  if (steps.length === 0)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">Steps</span>
        <p className="text-muted-foreground">Not written yet.</p>
      </div>
    );
  // Conditions bite on the main transaction, the last thing signed (the deposit, not the approval before it).
  const branchAt = steps.findLastIndex(stepSigns);
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted-foreground">Steps</span>
        <StepList
          className="overflow-hidden rounded-xl border bg-card shadow-xs"
          steps={steps.map((s, i) => ({
            text: s.text,
            result: result?.steps[i],
            shot: url(result?.steps[i]?.screenshot),
            signs: stepSigns(s),
            after: wallet === "signs" && i === branchAt ? <div id="conditions" className="scroll-mt-24">{forks}</div> : undefined,
          }))}
        />
        {wallet && wallet !== "signs" && (
          <div className="flex flex-col gap-2 px-1 pt-1">
            {hasConditions && forks}
            <p className="flex gap-2 text-sm text-muted-foreground">
              <Wallet className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {wallet === "none" ? "This test never asks the wallet to sign, so conditions have nothing to change." : "Conditions unlock once a run of this test reaches the wallet."}
            </p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** What the app's setup did before this run: folded away unless it's why the test couldn't run. */
function SetupRun({ appId, run, setup, url }: { appId: string; run: SetupRunResult; setup: AppSetup | null; url: (p?: string | null) => string | null }) {
  // Steps edited since the run no longer line up with its results.
  const texts = setup && setup.steps.length === run.steps.length ? setup.steps.map((s) => s.text) : run.steps.map((_, i) => `Step ${i + 1}`);
  const notes = [
    run.reused && "ran before an earlier test of this run; this test started from where it left off",
    run.shared && "on a live chain this test also started from what earlier tests left",
  ].filter(Boolean);
  return (
    <details open={!run.ok} className="group/setup flex flex-col gap-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <StateMark state={run.ok ? "pass" : run.steps.some((s) => s.status === "running") ? "running" : "error"} />
        <span>Setup</span>
        <span className="font-normal">
          · {SETUP_WHEN_LABEL[run.when].toLowerCase()} · {run.ok ? "passed" : run.steps.some((s) => s.status === "running") ? "running" : <span className="text-warn">didn't finish</span>}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {notes.length > 0 && <p className="text-sm text-muted-foreground">It {notes.join("; ")}.</p>}
        <StepList className="overflow-hidden rounded-xl border bg-card shadow-xs" steps={texts.map((text, i) => ({ text, result: run.steps[i], shot: url(run.steps[i]?.screenshot) }))} />
        <Link href={`/apps/${appId}`} className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Edit the setup
        </Link>
      </div>
    </details>
  );
}

function Media({ run, result, url }: { run?: TestRunRow; result?: TestRunResult; url: (p?: string | null) => string | null }) {
  if (!run) return null;
  const running = run.status === "running";
  const frame = running ? url(run.liveFrame) : url(result?.finalScreenshot);
  const video = !running ? url(result?.video) : null;
  if (!frame && !video)
    return running || run.status === "queued" ? (
      <div className="flex aspect-[16/10] items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-xs">{running ? "Opening the app…" : "Waiting for a browser…"}</div>
    ) : null;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      {video ? (
        <video src={video} poster={frame ?? undefined} controls muted playsInline className="block aspect-[16/10] w-full bg-muted object-contain" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame!} alt={running ? "The test running now" : "The page when the test finished"} className="block aspect-[16/10] w-full bg-muted object-cover object-top" />
      )}
      {running && (
        <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-live">
          <span className="size-1.5 animate-pulse rounded-full bg-live" /> Live
        </div>
      )}
    </div>
  );
}

/** Every result of this test, newest first. Each belongs to a run (a batch), which the Runs page lists. */
function History({ appId, testId, runs, selected }: { appId: string; testId: string; runs: TestRunRow[]; selected?: string }) {
  return (
    <Panel title="Results" count={runs.length}>
      <ul className="divide-y">
        {runs.map((r, i) => (
          <li key={r.id}>
            <Link
              href={i === 0 ? `/apps/${appId}/tests/${testId}` : `/apps/${appId}/tests/${testId}?run=${r.id}`}
              aria-current={r.id === selected ? "true" : undefined}
              className={cx("flex items-center gap-3 px-4 py-2 hover:bg-accent/50", r.id === selected && "bg-accent")}
            >
              <StateMark state={r.status} />
              <span className={cx("flex-1", STATE_TEXT[r.status])}>{STATE_LABEL[r.status]}</span>
              <span className="text-xs text-muted-foreground">{TRIGGER_LABEL[r.trigger]}</span>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
