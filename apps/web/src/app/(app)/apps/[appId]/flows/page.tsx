import { apiTokens, db, flowChanges, flows, repairs, scans, variations } from "@dappdrill/db";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { runAllAction } from "@/actions/flows";
import { rerunAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { DescribeForm, ScheduleForm } from "@/components/flows/forms";
import { ChangeCard, RepairBanner } from "@/components/flows/proposals";
import { cx, PlayIcon, RUN_STATUS_LABEL, RUN_STATUS_TEXT, Sparkbars } from "@/components/ui";
import { isHostVerified } from "@/lib/domains";
import { env } from "@/lib/env";
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
  const [statuses, last, openRepairs, changes, scanRows, varCounts, tokens, verified] = await Promise.all([
    recentStatuses(ids),
    lastRuns(ids),
    ids.length ? db().select().from(repairs).where(and(inArray(repairs.flowId, ids), eq(repairs.status, "open"))).orderBy(desc(repairs.createdAt)) : [],
    db().select().from(flowChanges).where(and(eq(flowChanges.appId, app.id), isNull(flowChanges.flowId), isNull(flowChanges.resolution))).orderBy(desc(flowChanges.createdAt)),
    scanIds.length ? db().select({ id: scans.id, number: scans.number }).from(scans).where(inArray(scans.id, scanIds)) : [],
    ids.length ? db().select({ flowId: variations.flowId, n: count() }).from(variations).where(inArray(variations.flowId, ids)).groupBy(variations.flowId) : [],
    db().select({ lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(eq(apiTokens.appId, app.id)),
    isHostVerified(app.teamId, app.host),
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
    <div className="page flex flex-col gap-8">
      {busy && <AutoRefresh every={4000} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">Flows</h1>
          <p className="m-0 text-[15px] text-ink-2">
            {plural(flowRows.length, "saved flow")}. Replays don&apos;t use your scan allowance, so run them as often as you like.
          </p>
        </div>
        <div className="flex gap-2">
          <details className="relative">
            <summary className="btn list-none">Schedule</summary>
            <div className="card absolute right-0 z-20 mt-2 w-[320px] p-5 shadow-lg">
              <ScheduleForm appId={app.id} time={app.scheduleTime} verified={verified} host={app.host} />
            </div>
          </details>
          <form action={runAllAction}>
            <input type="hidden" name="appId" value={app.id} />
            <button type="submit" className="btn btn-primary" disabled={flowRows.length === 0}>
              <PlayIcon /> Run all
            </button>
          </form>
        </div>
      </div>

      {error && (
        <p role="alert" className="m-0 rounded-xl border border-bad-line bg-bad-soft px-5 py-3 text-sm text-bad-ink">
          {error}
        </p>
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
          Keeping flows in your repo? <code className="font-mono">dappdrill push-flows --report-to {env.appUrl}</code> uploads them; see{" "}
          <Link href="/account#tokens">API tokens</Link>.
        </p>
      </section>

      <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <span>{app.scheduleTime ? `Every day at ${app.scheduleTime} UTC` : "No daily schedule"}</span>
        <span>{ciUsed ? "On every pull request, via GitHub Action" : <Link href="/account#tokens">Set up the GitHub Action</Link>}</span>
      </p>

      {changes.map((c) => (
        <ChangeCard key={c.id} change={c} />
      ))}
      {openRepairs.map((r) => {
        const f = flowRows.find((x) => x.id === r.flowId);
        return f ? <RepairBanner key={r.id} repair={r} flowName={f.name} current={f.definition} /> : null;
      })}

      {flowRows.length === 0 ? (
        <p className="m-0 rounded-xl border border-line bg-card px-5 py-4 text-sm text-muted">
          No saved flows yet. A scan saves every flow it finds, or describe one above.
        </p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>Flow</th>
                <th className="text-right">Steps</th>
                <th className="text-right">Signatures</th>
                <th>Last run</th>
                <th>Last 10 runs</th>
                <th className="sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {flowRows.map((f) => {
                const l = last.get(f.id);
                const needsFix = repairFor.has(f.id);
                return (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/apps/${app.id}/flows/${f.id}`} className="font-medium no-underline hover:underline">
                        {f.name}
                      </Link>
                      <div className="text-[13px] text-muted">{origin(f)}</div>
                    </td>
                    <td className="text-right tabular-nums">{f.definition.steps.length}</td>
                    <td className="text-right tabular-nums">{f.definition.steps.filter((s) => s.kind === "wallet").length}</td>
                    <td>
                      <span className={cx("text-sm", needsFix ? "text-warn" : l ? RUN_STATUS_TEXT[l.status] : "text-muted")}>
                        {needsFix ? "Needs a fix" : l ? RUN_STATUS_LABEL[l.status] : "Not run yet"}
                      </span>
                      {l && <span className="text-[13px] text-muted"> · {timeAgo(l.at)}</span>}
                    </td>
                    <td>
                      <Sparkbars statuses={statuses.get(f.id) ?? []} />
                    </td>
                    <td className="text-right">
                      <form action={rerunAction}>
                        <input type="hidden" name="appId" value={app.id} />
                        <input type="hidden" name="flowId" value={f.id} />
                        <button type="submit" className="btn btn-sm" aria-label={`Run ${f.name}`}>
                          <PlayIcon /> Run
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 flex gap-4 text-[13px] text-muted">
        <Legend cls="bg-quiet" label="Passed" />
        <Legend cls="bg-warn-bar" label="Note or fix needed" />
        <Legend cls="bg-bad" label="Failed" />
      </p>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("h-3 w-2 rounded-[2px]", cls)} />
      {label}
    </span>
  );
}
