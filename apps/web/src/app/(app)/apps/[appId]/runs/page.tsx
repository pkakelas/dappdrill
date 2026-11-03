import { edgeCaseInfo } from "@dappdrill/core";
import { db, flows, runBatches, scans } from "@dappdrill/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Empty, HealthBadge, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateTime, minutesBetween, plural, timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { healthOfCounts, issueCounts } from "@/lib/queries";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Runs" };

type Row = {
  id: string;
  href: string;
  what: string;
  sub?: string;
  status: string;
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
    <div className="page">
      {busy && <AutoRefresh every={4000} />}
      <PageHeader title="Runs" description="Discovery scans and replays of your saved flows, newest first." />
      {rows.length === 0 ? (
        <Empty title="Nothing has run yet">
          <p className="mb-4">Start a scan, or run your flows from the Flows tab.</p>
          <Button asChild>
            <Link href={`/new?app=${app.id}`}>Start a scan</Link>
          </Button>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">What</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Commit</TableHead>
                <TableHead className="pr-4">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Link href={r.href} className="flex flex-col">
                      <span className="font-medium hover:underline">{r.what}</span>
                      {r.sub && <span className="text-xs text-muted-foreground">{r.sub}</span>}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {r.status === "done" ? (
                      <HealthBadge health={healthOfCounts(r.counts)} />
                    ) : r.status === "queued" || r.status === "running" ? (
                      <Badge variant="secondary" className="rounded-md bg-live-bg text-live-ink">
                        {r.status === "queued" ? "Queued" : "Running"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="rounded-md text-muted-foreground">
                        {r.status === "failed" ? "Failed" : "Stopped"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{TRIGGER_LABEL[r.trigger]}</TableCell>
                  <TableCell>
                    {r.commit || r.branch ? (
                      <span className="font-mono text-xs">
                        {r.commit?.slice(0, 7)}
                        {r.branch && <span className="text-muted-foreground"> {r.branch}</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground" title={dateTime(r.at)}>
                    {timeAgo(r.at)}
                    {r.duration && ` · ${r.duration}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
