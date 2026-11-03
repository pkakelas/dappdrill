import { apiTokens, db, flowChanges, flows, repairs, scans, variations } from "@dappdrill/db";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { runAllAction } from "@/actions/flows";
import { rerunAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { DescribeForm } from "@/components/flows/forms";
import { ChangeCard, RepairBanner } from "@/components/flows/proposals";
import { ActionButton, Empty, Notice, PageHeader, PlayIcon, RunState, SparkLegend, Sparkbars } from "@/components/ui";
import { plural, timeAgo } from "@/lib/format";
import { lastRuns, recentStatuses, type FlowRow } from "@/lib/queries";
import { requireApp } from "@/lib/session";

type Props = { params: Promise<{ appId: string }>; searchParams: Promise<{ error?: string }> };

export const metadata: Metadata = { title: "Flows" };

export default async function FlowsPage({ params, searchParams }: Props) {
  const { appId } = await params;
  const { error } = await searchParams;
  const { app } = await requireApp(appId);

  const flowRows = await db().select().from(flows).where(and(eq(flows.appId, app.id), eq(flows.archived, false))).orderBy(asc(flows.createdAt));
  const ids = flowRows.map((f) => f.id);
  const scanIds = [...new Set(flowRows.map((f) => f.scanId).filter((x): x is string => Boolean(x)))];
  const [statuses, last, openRepairs, changes, scanRows, varCounts, tokens] = await Promise.all([
    recentStatuses(ids),
    lastRuns(ids),
    ids.length ? db().select().from(repairs).where(and(inArray(repairs.flowId, ids), eq(repairs.status, "open"))).orderBy(desc(repairs.createdAt)) : [],
    db().select().from(flowChanges).where(and(eq(flowChanges.appId, app.id), isNull(flowChanges.flowId), isNull(flowChanges.resolution))).orderBy(desc(flowChanges.createdAt)),
    scanIds.length ? db().select({ id: scans.id, number: scans.number }).from(scans).where(inArray(scans.id, scanIds)) : [],
    ids.length ? db().select({ flowId: variations.flowId, n: count() }).from(variations).where(inArray(variations.flowId, ids)).groupBy(variations.flowId) : [],
    db().select({ lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(eq(apiTokens.appId, app.id)),
  ]);
  const scanNo = new Map(scanRows.map((s) => [s.id, s.number]));
  const varN = new Map(varCounts.map((v) => [v.flowId, v.n]));
  const repairFor = new Map(openRepairs.map((r) => [r.flowId, r]));
  const busy = changes.some((c) => c.status === "queued" || c.status === "running");
  const ciUsed = tokens.some((t) => t.lastUsedAt);

  function origin(f: FlowRow): string {
    const n = varN.get(f.id);
    const base =
      f.definition.origin === "discovered" && f.scanId && scanNo.has(f.scanId)
        ? `Found by scan #${scanNo.get(f.scanId)}`
        : f.definition.origin === "described"
          ? "Added by you, in plain English"
          : f.definition.origin === "recorded"
            ? "Recorded by you"
            : f.definition.origin === "code"
              ? "From your repo"
              : "Found by a scan";
    return n ? `${base} · ${plural(n, "variation")}` : base;
  }

  return (
    <div className="page gap-8">
      {busy && <AutoRefresh every={4000} />}
      <PageHeader
        title="Flows"
        sub={<>{plural(flowRows.length, "saved flow")}. Replays don&apos;t use your scan allowance, so run them as often as you like.</>}
        actions={
          <ActionButton action={runAllAction} fields={{ appId: app.id }} className="btn-primary" pendingText="Queuing…" disabled={flowRows.length === 0}>
            <PlayIcon /> Run all
          </ActionButton>
        }
      >
        <p className="meta m-0 flex flex-wrap gap-x-5 gap-y-1">
          <Link href={`/apps/${app.id}/settings#schedule-section`} className="no-underline hover:underline">
            {app.scheduleTime ? `Every day at ${app.scheduleTime} UTC` : "No daily schedule"}
          </Link>
          <Link href={`/apps/${app.id}/settings#ci-section`} className="no-underline hover:underline">
            {ciUsed ? "On every pull request" : "Not on pull requests yet"}
          </Link>
        </p>
      </PageHeader>

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {changes.map((c) => (
        <ChangeCard key={c.id} change={c} />
      ))}
      {openRepairs.map((r) => {
        const f = flowRows.find((x) => x.id === r.flowId);
        return f ? <RepairBanner key={r.id} repair={r} flowName={f.name} current={f.definition} /> : null;
      })}

      {flowRows.length === 0 ? (
        <Empty title="No saved flows yet">A scan saves every flow it finds. Or describe one below and the agent walks it once to save the steps.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="card overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Flow</th>
                  <th className="text-right">Steps</th>
                  <th className="text-right">Signatures</th>
                  <th>Last run</th>
                  <th>Last 10 runs</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {flowRows.map((f) => {
                  const l = last.get(f.id);
                  return (
                    <tr key={f.id}>
                      <td>
                        <Link href={`/apps/${app.id}/flows/${f.id}`} className="stretched font-medium no-underline">
                          {f.name}
                        </Link>
                        <div className="meta">{origin(f)}</div>
                      </td>
                      <td className="text-right tabular-nums">{f.definition.steps.length}</td>
                      <td className="text-right tabular-nums">{f.definition.steps.filter((s) => s.kind === "wallet").length}</td>
                      <td className="text-sm">
                        <RunState status={l?.status} needsFix={repairFor.has(f.id)} />
                        {l && <span className="meta"> · {timeAgo(l.at)}</span>}
                      </td>
                      <td>
                        <Sparkbars statuses={statuses.get(f.id) ?? []} />
                      </td>
                      <td className="text-right">
                        <ActionButton action={rerunAction} fields={{ appId: app.id, flowId: f.id }} className="btn-sm" pendingText="Queuing…" aria-label={`Run ${f.name}`}>
                          <PlayIcon /> Run
                        </ActionButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <SparkLegend />
        </div>
      )}

      <section className="card flex flex-col gap-3 p-5 sm:p-6" aria-label="Add a flow">
        <DescribeForm
          appId={app.id}
          label="Add a flow"
          placeholder="e.g. Deposit 50 USDC, then withdraw half of it"
          hint="It walks the flow once with the wallet, shows you the steps, and saves them after you confirm."
          button="Add flow"
        />
        <p className="hint m-0">
          Keeping flows in your repo?{" "}
          <Link href={`/apps/${app.id}/settings#ci-section`} className="prose-link">
            Push them with the CLI
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
