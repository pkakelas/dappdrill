import { edgeCaseInfo } from "@dappdrill/core";
import { db, flows, runBatches, scans } from "@dappdrill/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Empty, JobStatus, Mono, PageHeader, type JobStatusValue } from "@/components/ui";
import { dateTime, minutesBetween, plural, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { healthOfCounts, issueCounts } from "@/lib/queries";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Runs" };

type Row = {
  id: string;
  href: string;
  what: string;
  sub?: string;
  status: JobStatusValue;
  trigger: keyof typeof TRIGGER_LABEL;
  commit?: string;
  branch?: string;
  at: Date;
  duration: string;
  counts?: Parameters<typeof healthOfCounts>[0];
};

export default async function RunsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { app } = await requireApp((await params).appId);
  const [scanRows, batchRows] = await Promise.all([
    db().select().from(scans).where(eq(scans.appId, app.id)).orderBy(desc(scans.createdAt)).limit(50),
    db().select().from(runBatches).where(and(eq(runBatches.appId, app.id), isNull(runBatches.scanId))).orderBy(desc(runBatches.createdAt)).limit(100),
  ]);
  const flowIds = [...new Set(batchRows.flatMap((b) => b.request.flowIds))];
  const [scanCounts, batchCounts, flowNames] = await Promise.all([
    issueCounts("scan", scanRows.map((s) => s.id)),
    issueCounts("batch", batchRows.map((b) => b.id)),
    flowIds.length ? db().select({ id: flows.id, name: flows.name }).from(flows).where(inArray(flows.id, flowIds)) : Promise.resolve([]),
  ]);
  const names = new Map(flowNames.map((f) => [f.id, f.name]));

  const rows: Row[] = [
    ...scanRows.map<Row>((s) => ({
      id: s.id,
      href: `/apps/${app.id}/scans/${s.id}`,
      what: `Discovery scan #${s.number}`,
      status: s.status,
      trigger: s.trigger,
      at: s.createdAt,
      duration: minutesBetween(s.startedAt, s.finishedAt),
      counts: scanCounts.get(s.id),
    })),
    ...batchRows.map<Row>((b) => {
      const ids = b.request.flowIds;
      const what = ids.length === 1 ? (names.get(ids[0]!) ?? "Deleted flow") : `${plural(ids.length, "flow")}`;
      const cases = b.request.edgeCases;
      return {
        id: b.id,
        href: `/apps/${app.id}/runs/${b.id}`,
        what: b.trigger === "ci" ? `CI run · ${what}` : what,
        sub: cases.length === 1 ? edgeCaseInfo(cases[0]!).label : `${cases.length} edge cases`,
        status: b.status,
        trigger: b.trigger,
        commit: b.request.commit,
        branch: b.request.branch,
        at: b.createdAt,
        duration: minutesBetween(b.startedAt, b.finishedAt),
        counts: batchCounts.get(b.id),
      };
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const busy = rows.some((r) => r.status === "queued" || r.status === "running");

  return (
    <div className="page gap-8">
      {busy && <AutoRefresh every={4000} />}
      <PageHeader title="Runs" sub="Discovery scans and replays of your saved flows, newest first." />
      {rows.length === 0 ? (
        <Empty
          title="Nothing has run yet"
          action={
            <>
              <Link href={`/new?app=${app.id}`} className="btn btn-primary">
                Start a scan
              </Link>
              <Link href={`/apps/${app.id}/flows`} className="btn">
                Go to flows
              </Link>
            </>
          }
        >
          A scan finds the flows; replays run them against every wallet edge case.
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[680px]">
            <thead>
              <tr>
                <th>What</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Commit</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={r.href} className="stretched flex flex-col no-underline">
                      <span className="font-medium">{r.what}</span>
                      {r.sub && <span className="meta">{r.sub}</span>}
                    </Link>
                  </td>
                  <td>
                    <JobStatus status={r.status} health={healthOfCounts(r.counts)} />
                  </td>
                  <td className="text-meta text-ink-2">{TRIGGER_LABEL[r.trigger]}</td>
                  <td className="text-meta">
                    {r.commit || r.branch ? (
                      <Mono>
                        {r.commit?.slice(0, 7)}
                        {r.branch && <span className="text-muted"> {r.branch}</span>}
                      </Mono>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="meta" title={dateTime(r.at)}>
                    {timeAgo(r.at)}
                    {r.duration && ` · ${r.duration}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
