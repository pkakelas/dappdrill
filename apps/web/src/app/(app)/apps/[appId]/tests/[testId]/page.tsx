import { conditionInfo, formatDuration, SETUP_WHEN_LABEL, signingOf, signingText, stepSigns, walletUse, type AppSetup, type SetupRunResult, type TestRunResult, type TestStep } from "@dappdrill/core";
import { db, flows, latestRuns, settledRuns, specOf, testRuns, tests, type TestRunRow } from "@dappdrill/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { Check, ChevronDown, CircleAlert, CircleX, Clock, Copy, GitBranch, History as HistoryIcon, LoaderCircle, ShieldAlert, Timer, Wallet, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTestAction } from "@/actions/tests";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { ConditionPills, failureParts } from "@/components/tests/condition-pills";
import { AddConditions } from "@/components/tests/conditions";
import { Duplicate } from "@/components/tests/duplicate";
import { RunButton } from "@/components/tests/run-button";
import { RunDetails } from "@/components/tests/run-details";
import { StepList } from "@/components/tests/setup-steps";
import { SpecEditor } from "@/components/tests/spec-editor";
import { isActive, readTest, STATE_LABEL, STATE_TEXT, StateBadge, StateMark } from "@/components/tests/status";
import { cx, Tag } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  const [[flow], [base], children, history, [forkedFrom]] = await Promise.all([
    db().select().from(flows).where(eq(flows.id, test.flowId)),
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
  const settled = history.find((r) => r.status === "pass" || r.status === "fail" || r.status === "error" || r.status === "skipped");
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
  const pills = !test.baseId && (
    <ConditionPills appId={appId} tests={children} reads={childReads} runs={childSettled}>
      {wallet === "signs" && <AddConditions testId={test.id} existing={children.flatMap((c) => (c.condition ? [c.condition] : []))} startOpen={add === "conditions"} />}
    </ConditionPills>
  );
  const url = (path?: string | null) => (run ? artifactUrl("runs", run.batchId, path) : null);
  const signingNote = signingText(signing);
  const setupRun = result?.setup && <SetupRun appId={appId} run={result.setup} setup={app.setup} url={url} />;

  return (
    <div className="page flex flex-col gap-8">
      {(isActive(state) || childActive) && <AutoRefresh every={2000} />}

      <header className="flex flex-col gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/apps/${appId}`}>Flows</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-muted-foreground">{flow?.name}</BreadcrumbPage>
            </BreadcrumbItem>
            {base && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/apps/${appId}/tests/${base.id}`}>{base.name}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{spec.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StateBadge state={state.mark} />
              {state.active && state.settled !== "never" && !state.drafting && <StateBadge state={state.active} />}
              {signingNote && (
                <Tag tone={signing.dangerous > 0 ? "bad" : "warn"} className="h-6 gap-1 px-2">
                  <ShieldAlert /> {signingNote}
                </Tag>
              )}
              {settled?.finishedAt && <Fact icon={Clock}>{timeAgo(settled.finishedAt)}</Fact>}
              {settled?.startedAt && settled.finishedAt && <Fact icon={Timer}>Took {formatDuration(settled.finishedAt.getTime() - settled.startedAt.getTime())}</Fact>}
              {forkedFrom && (
                <Fact icon={Copy}>
                  Duplicated from{" "}
                  <Link href={`/apps/${appId}/tests/${forkedFrom.id}`} className="underline underline-offset-4 hover:text-foreground">
                    {forkedFrom.name}
                  </Link>
                </Fact>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RunButton target={{ appId, testIds: [test.id] }} active={Boolean(state.active)} stopIds={[test.id]} label="Run" size="md" primary disabled={state.drafting} />
            {!test.baseId && !state.drafting && <Duplicate testId={test.id} />}
            <ConfirmButton className={cx(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")} onConfirm={deleteTestAction.bind(null, test.id)}>
              Delete
            </ConfirmButton>
          </div>
        </div>
      </header>

      {(test.drafting || viewingOld || (result?.failure && (runState === "fail" || runState === "error")) || runState === "skipped") && (
        <div className="flex flex-col gap-3">
          {test.drafting && (
            <Alert variant="quiet">
              <LoaderCircle className="animate-spin" />
              <AlertTitle className="line-clamp-none font-normal">Writing this test from “{test.drafting}”. It runs as soon as the steps are ready.</AlertTitle>
            </Alert>
          )}
          {viewingOld && (
            <Alert variant="quiet">
              <HistoryIcon />
              <AlertTitle className="flex flex-wrap items-center justify-between gap-x-3 font-normal">
                <span>
                  Showing the result from {timeAgo(run.createdAt)} ({STATE_LABEL[run.status].toLowerCase()}).
                </span>
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href={`/apps/${appId}/tests/${test.id}`}>Back to the latest</Link>
                </Button>
              </AlertTitle>
            </Alert>
          )}
          {result?.failure && (runState === "fail" || runState === "error") && <FailureAlert failure={result.failure} verdict={result.verdict} failed={runState === "fail"} />}
          {runState === "skipped" && (
            <Alert role="status" variant="quiet">
              <CircleAlert />
              <AlertTitle>Doesn&apos;t apply here</AlertTitle>
              <AlertDescription>{result?.failure ?? "This condition can't be set up for this test."} It is left out of the counts.</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className={cx("grid items-start gap-x-14 gap-y-10", run && "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
        <div className="flex min-w-0 flex-col gap-8">
          {condition && base ? (
            // A condition row has nothing of its own to edit: steps and goal are the test's, name and expected the condition's.
            <>
              <p className="flex gap-2 text-muted-foreground">
                <GitBranch className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Runs the steps of{" "}
                  <Link href={`/apps/${appId}/tests/${base.id}`} className="underline underline-offset-4 hover:text-foreground">
                    {base.name}
                  </Link>{" "}
                  under the condition <strong className="font-semibold text-foreground">{condition.name}</strong>. Edit the test to change what runs.
                </span>
              </p>
              <Summary goal={base.goal} expected={condition.expected} result={result} />
              <Steps steps={steps} result={result} url={url} setup={setupRun} />
            </>
          ) : (
            <SpecEditor
              testId={test.id}
              spec={{ name: test.name, goal: test.goal, expected: test.expected, steps: test.steps.map((s) => s.text) }}
              stepsFixed={false}
              disabled={Boolean(test.drafting)}
              summary={<Summary goal={test.goal} expected={test.expected} result={result} />}
              steps={<Steps steps={steps} result={result} url={url} setup={setupRun} pills={pills} wallet={test.baseId ? undefined : wallet} hasConditions={children.length > 0} />}
            />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <Media run={run} result={result} url={url} />
          <RunDetails result={result} history={history.length > 1 ? { count: history.length, list: <History appId={appId} testId={test.id} runs={history} selected={run?.id} /> } : undefined} />
        </aside>
      </div>
    </div>
  );
}

/** A small fact beside the status, with its icon. */
function Fact({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** Why the run failed: where as the title and why below it, so the reason reads once, up here. */
function FailureAlert({ failure, verdict, failed }: { failure: string; verdict: TestRunResult["verdict"]; failed: boolean }) {
  const { where, why } = failureParts(failure);
  const missed = verdict?.ok === false;
  return (
    <Alert role="status" variant={failed ? "bad" : "warn"} className="rounded-xl px-5 py-4">
      {failed ? <CircleX /> : <CircleAlert />}
      <AlertTitle className="line-clamp-none">{where ?? (missed ? "The expected result didn't show" : failed ? "This test failed" : "This test couldn't run")}</AlertTitle>
      <AlertDescription className="block leading-relaxed">{missed ? verdict.reason : why}</AlertDescription>
    </Alert>
  );
}

function Summary({ goal, expected, result }: { goal: string; expected: string; result?: TestRunResult }) {
  const notWritten = <span className="text-muted-foreground">Not written yet</span>;
  return (
    <dl className="grid gap-6 sm:grid-cols-2 sm:gap-8">
      <Block label="Goal">
        {goal || notWritten}
      </Block>
      <Block label="Expected result">
        {expected || notWritten}
        {result?.verdict?.ok && (
          <span className="mt-2 flex gap-1.5 text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{result.verdict.reason}</span>
          </span>
        )}
      </Block>
    </dl>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex flex-col text-[0.9375rem] leading-relaxed text-pretty">{children}</dd>
    </div>
  );
}

function StepsHeading({ aside }: { aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-medium text-muted-foreground">Steps</h2>
      {aside}
    </div>
  );
}

function Steps({
  steps,
  result,
  url,
  setup,
  pills,
  wallet,
  hasConditions,
}: {
  steps: TestStep[];
  result?: TestRunResult;
  url: (p?: string | null) => string | null;
  setup?: React.ReactNode;
  pills?: React.ReactNode;
  wallet?: ReturnType<typeof walletUse>;
  hasConditions?: boolean;
}) {
  if (steps.length === 0)
    return (
      <section className="flex flex-col gap-2">
        <StepsHeading />
        {setup}
        <p className="text-muted-foreground">No steps yet. The first run works them out from the goal.</p>
      </section>
    );
  // Conditions bite on the main transaction, the last thing signed (the deposit, not the approval before it).
  const branchAt = steps.findLastIndex(stepSigns);
  // The failure banner already gives this step's reason.
  const explained = result?.failure && failureParts(result.failure).where ? result.steps.findIndex((s) => s.status === "fail") : -1;
  const ran = result?.steps.some((s) => s.status === "pass" || s.status === "fail" || s.status === "running");
  return (
    <TooltipProvider>
      <section className="flex flex-col gap-2">
        <StepsHeading
          aside={
            ran && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {result!.steps.filter((s) => s.status === "pass").length} of {steps.length} passed
              </span>
            )
          }
        />
        {setup}
        <StepList
          steps={steps.map((s, i) => {
            const r = result?.steps[i];
            return {
              text: s.text,
              result: r && i === explained ? { ...r, note: undefined } : r,
              shot: url(r?.screenshot),
              signs: stepSigns(s),
              after: wallet === "signs" && i === branchAt ? <div id="conditions" className="scroll-mt-24">{pills}</div> : undefined,
            };
          })}
        />
        {wallet && wallet !== "signs" && (
          <div className="mt-2 flex flex-col gap-2">
            {hasConditions && pills}
            <p className="flex gap-2 text-muted-foreground">
              <Wallet className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {wallet === "none" ? "This test never asks the wallet to sign, so conditions have nothing to change." : "Conditions unlock once a run of this test reaches the wallet."}
            </p>
          </div>
        )}
      </section>
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
  const running = run.steps.some((s) => s.status === "running");
  return (
    <Collapsible defaultOpen={!run.ok}>
      <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-md py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex size-6 shrink-0 items-center justify-center">
          <StateMark state={run.ok ? "pass" : running ? "running" : "error"} />
        </span>
        <span className="font-medium">Setup</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {SETUP_WHEN_LABEL[run.when].toLowerCase()} · {run.ok ? "passed" : running ? "running" : <span className="text-warn">didn&apos;t finish</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-2 pl-9">
        {notes.length > 0 && <p className="pb-2 text-muted-foreground">It {notes.join("; ")}.</p>}
        <StepList steps={texts.map((text, i) => ({ text, result: run.steps[i], shot: url(run.steps[i]?.screenshot) }))} />
        <Link href={`/apps/${appId}`} className="mt-1 inline-block text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Edit the setup
        </Link>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Media({ run, result, url }: { run?: TestRunRow; result?: TestRunResult; url: (p?: string | null) => string | null }) {
  if (!run) return null;
  const running = run.status === "running";
  const frame = running ? url(run.liveFrame) : url(result?.finalScreenshot);
  const video = !running ? url(result?.video) : null;
  if (!frame && !video)
    return running || run.status === "queued" ? (
      <div className="flex aspect-[16/10] items-center justify-center rounded-xl bg-muted text-muted-foreground">{running ? "Opening the app…" : "Waiting for a browser…"}</div>
    ) : null;
  return (
    <div className="overflow-hidden rounded-xl">
      {video ? (
        <video src={video} poster={frame ?? undefined} controls muted playsInline className="block aspect-[16/10] w-full bg-muted object-contain" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame!} alt={running ? "The test running now" : "The page when the test finished"} className="block aspect-[16/10] w-full bg-muted object-cover object-top" />
      )}
      {running && (
        <div className="flex items-center gap-2 pt-2 text-xs text-live">
          <span className="size-1.5 animate-pulse rounded-full bg-live" /> Live
        </div>
      )}
    </div>
  );
}

/** Every result of this test, newest first. Each belongs to a run (a batch), which the Runs page lists. */
function History({ appId, testId, runs, selected }: { appId: string; testId: string; runs: TestRunRow[]; selected?: string }) {
  return (
    <ul className="max-h-80 divide-y divide-border/60 overflow-auto">
      {runs.map((r, i) => (
        <li key={r.id}>
          <Link
            href={i === 0 ? `/apps/${appId}/tests/${testId}` : `/apps/${appId}/tests/${testId}?run=${r.id}`}
            aria-current={r.id === selected ? "true" : undefined}
            className={cx("flex items-center gap-3 py-3 hover:text-foreground", r.id === selected && "font-medium")}
          >
            <StateMark state={r.status} />
            <span className={cx("flex-1", STATE_TEXT[r.status])}>{STATE_LABEL[r.status]}</span>
            <span className="text-xs text-muted-foreground">{TRIGGER_LABEL[r.trigger]}</span>
            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
