import { BUG_STATUS_LABEL, TIER_LABEL, VARIATION_LABEL, type ExploreBug, type ExploreCandidate, type ExploreCheck, type ExploreState, type SweepResults } from "@dappdrill/core";
import { db, explorations, tests } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { retireTestAction, sweepAction } from "@/actions/explore";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { Coverage, ExploreLive } from "@/components/explore/live";
import { MakeTest, TriageSelect } from "@/components/explore/report-controls";
import { StateMark } from "@/components/tests/status";
import { cx, PageHeader, Section } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";
import { coverOf, liveBug, liveView, type Exploration } from "@/lib/explore";
import { minutesBetween, timeAgo } from "@/lib/format";
import { requireApp } from "@/lib/session";

export const metadata = { title: "Exploration" };

const SEVERITY_TEXT: Record<ExploreBug["severity"], string> = { critical: "text-bad", high: "text-bad", medium: "text-warn", low: "text-muted-foreground" };

function Evidence({ bug, explorationId }: { bug: ExploreBug; explorationId: string }) {
  const shot = artifactUrl("explorations", explorationId, bug.evidence.screenshot);
  const lines = [...bug.evidence.chain, ...bug.evidence.console, ...bug.evidence.network.map((h) => `Requests failed: ${h}`)];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Steps and evidence</summary>
      <div className="flex flex-col gap-3 pt-3">
        <ol className="list-decimal pl-5">
          {bug.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {bug.reasoning && <p className="text-muted-foreground">{bug.reasoning}</p>}
        {lines.length > 0 && <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">{lines.join("\n")}</pre>}
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt={`The page when ${bug.name} happened`} className="max-w-xl rounded-md border" />
        )}
      </div>
    </details>
  );
}

function BugLine({ bug, row }: { bug: ExploreBug; row: Exploration }) {
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">{bug.name}</span>
          <span className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
            <span className={cx("capitalize", SEVERITY_TEXT[bug.severity])}>{bug.severity}</span>·<span>{BUG_STATUS_LABEL[bug.status]}</span>·<span>{bug.flow}</span>
          </span>
        </div>
        <TriageSelect explorationId={row.id} bugId={bug.id} value={row.triage[bug.id] ?? "open"} />
      </div>
      <p className="text-sm">{bug.summary}</p>
      <p className="text-sm text-muted-foreground">
        Expected: {bug.expected} Got: {bug.actual}
      </p>
      <Evidence bug={bug} explorationId={row.id} />
    </li>
  );
}

function Bugs({ state, row }: { state: ExploreState; row: Exploration }) {
  const dismissed = state.bugs.filter((b) => !liveBug(b));
  const open = state.bugs.filter(liveBug).sort((a, b) => Number(b.status === "confirmed") - Number(a.status === "confirmed"));
  return (
    <div className="flex flex-col gap-4">
      {open.length === 0 && <p className="text-sm text-muted-foreground">No bugs stood up to review.</p>}
      <ul className="flex flex-col divide-y">
        {open.map((b) => (
          <BugLine key={b.id} bug={b} row={row} />
        ))}
      </ul>
      {dismissed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{dismissed.length} set aside in review</summary>
          <ul className="flex flex-col gap-2 pt-3">
            {dismissed.map((b) => (
              <li key={b.id}>
                {b.name} <span className="text-muted-foreground">· {BUG_STATUS_LABEL[b.status]}{b.reasoning && ` · ${b.reasoning}`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CandidateLine({ c, appId, testId }: { c: ExploreCandidate; appId: string; testId?: string }) {
  const proved = c.status === "proved";
  return (
    <li className="flex flex-col gap-0.5 py-2.5 text-sm first:pt-0">
      <span className="flex flex-wrap items-center gap-2">
        <StateMark state={proved ? "pass" : "draft"} />
        {testId ? (
          <Link href={`/apps/${appId}/tests/${testId}`} className="font-medium hover:underline">
            {c.draft.name}
          </Link>
        ) : (
          <span className="font-medium">{c.draft.name}</span>
        )}
        <span className="text-muted-foreground">
          {c.flow} · {TIER_LABEL[c.tier]}
        </span>
        {c.bugId && <Badge variant="outline">Regression</Badge>}
      </span>
      <span className="pl-6 text-muted-foreground">{proved ? c.why : (c.note ?? c.why)}</span>
    </li>
  );
}

function CheckLine({ check, sweep, row, saved }: { check: ExploreCheck; sweep?: SweepResults; row: Exploration; saved: boolean }) {
  const later = sweep?.results[check.id];
  const changed = later && later.status !== check.status;
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="flex min-w-0 items-start gap-2">
        <StateMark state={check.status} />
        <span className="flex min-w-0 flex-col">
          <span>{check.name}</span>
          <span className="text-muted-foreground">
            {VARIATION_LABEL[check.variation]} · {check.evidence}
          </span>
          {changed && <span className="text-warn">Different on the latest repeat: {later.evidence}</span>}
        </span>
      </span>
      {check.status === "pass" && !saved && <MakeTest explorationId={row.id} checkId={check.id} />}
    </li>
  );
}

export default async function ExplorationPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const [[row], saved] = await Promise.all([
    db().select().from(explorations).where(eq(explorations.appId, appId)).orderBy(desc(explorations.createdAt)).limit(1),
    db().select({ id: tests.id, name: tests.name }).from(tests).where(eq(tests.appId, appId)),
  ]);
  if (!row) redirect(`/apps/${appId}`);

  if (row.status === "queued" || row.status === "running") {
    return (
      <div className="page flex flex-col gap-8">
        <AutoRefresh every={2000} />
        <ExploreLive view={liveView(row, app.url)} />
      </div>
    );
  }

  const state = row.state;
  const testIds = new Map(saved.map((t) => [t.name, t.id]));
  const flows = [...new Set(state?.checks.map((c) => c.flow) ?? [])];
  const candidates = state?.candidates.filter((c) => c.status === "proved" || c.status === "draft") ?? [];
  const covered = new Set(candidates.flatMap((c) => c.checkIds));
  const outcome = row.status === "failed" ? `Didn't finish: ${row.error ?? "something went wrong"}` : row.status === "stopped" ? "Stopped" : "Finished";

  return (
    <div className="page flex flex-col gap-2">
      <PageHeader
        title="Exploration"
        description={[`${outcome} ${timeAgo(row.finishedAt)}`, `took ${minutesBetween(row.startedAt, row.finishedAt)}`, `$${row.costUsd.toFixed(2)}`].join(" · ")}
        actions={
          <>
            <Link href={`/apps/${appId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to flows
            </Link>
            {row.replays.length > 0 && (
              <form action={sweepAction.bind(null, row.id)}>
                <Button type="submit" variant="outline" size="sm">
                  Repeat checks
                </Button>
              </form>
            )}
          </>
        }
      />

      {!state ? (
        <p className="py-10 text-sm text-muted-foreground">It stopped before it got anywhere.</p>
      ) : (
        <div className="flex flex-col">
          {state.stopped && <p className="pt-4 text-sm text-muted-foreground">{state.stopped}</p>}
          <Section title="Bugs" count={state.bugs.filter(liveBug).length} hint={row.status === "done" ? "Each was reviewed and tried again in a fresh browser. Your call stays with the bug." : "It ended before review, so these are only suspected."}>
            <Bugs state={state} row={row} />
          </Section>
          <Section title="Tests" count={candidates.length} hint="Proved tests passed on a fresh fork with none of the explorer's memory. Drafts keep their reason.">
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No new tests.</p>
            ) : (
              <ul className="flex flex-col">
                {candidates.map((c) => (
                  <CandidateLine key={c.id} c={c} appId={appId} testId={testIds.get(c.draft.name)} />
                ))}
              </ul>
            )}
          </Section>
          <Section title="Coverage" count={state.flows.length} hint="What it got to, flow by flow.">
            <Coverage flows={coverOf(state)} />
          </Section>
          {state.retire.length > 0 && (
            <Section title="Out of date" count={state.retire.length} hint="Tests that no longer look right. Nothing is removed unless you say so.">
              <ul className="flex flex-col divide-y">
                {state.retire
                  .filter((t) => saved.some((s) => s.id === t.testId))
                  .map((t) => (
                    <li key={t.testId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="flex min-w-0 flex-col">
                        <Link href={`/apps/${appId}/tests/${t.testId}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                        <span className="text-muted-foreground">{t.reason}</span>
                      </span>
                      <ConfirmButton onConfirm={retireTestAction.bind(null, row.id, t.testId)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                        Delete
                      </ConfirmButton>
                    </li>
                  ))}
              </ul>
            </Section>
          )}
          <Section title="Checks" count={state.checks.length} hint={row.sweep ? `Last repeated ${timeAgo(row.sweep.at)}.` : "Small things it confirmed along the way. Turn any of them into a test."}>
            <div className="flex flex-col gap-2">
              {flows.map((flow) => {
                const checks = state.checks.filter((c) => c.flow === flow);
                return (
                  <details key={flow}>
                    <summary className="cursor-pointer py-1 text-sm font-medium">
                      {flow} <span className="font-normal text-muted-foreground">{checks.length}</span>
                    </summary>
                    <ul className="flex flex-col divide-y">
                      {checks.map((c) => (
                        <CheckLine key={c.id} check={c} sweep={row.sweep ?? undefined} row={row} saved={covered.has(c.id) || testIds.has(c.name)} />
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
