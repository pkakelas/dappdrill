import { db, flows, runBatches, scans } from "@dappdrill/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ActivityItem, buildActivity } from "@/components/activity";
import { Empty, ItemList, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { activityOutcomes, flowCountsByScan } from "@/lib/queries";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { app } = await requireApp((await params).appId);
  const [scanRows, batchRows] = await Promise.all([
    db().select().from(scans).where(eq(scans.appId, app.id)).orderBy(desc(scans.createdAt)).limit(50),
    db().select().from(runBatches).where(and(eq(runBatches.appId, app.id), isNull(runBatches.scanId))).orderBy(desc(runBatches.createdAt)).limit(100),
  ]);
  const flowIds = [...new Set(batchRows.flatMap((b) => b.request.flowIds))];
  const scanIds = scanRows.map((s) => s.id);
  const batchIds = batchRows.map((b) => b.id);
  const [flowNames, found, outcomes] = await Promise.all([
    flowIds.length ? db().select({ id: flows.id, name: flows.name }).from(flows).where(inArray(flows.id, flowIds)) : Promise.resolve([]),
    flowCountsByScan(scanIds),
    activityOutcomes(scanIds, batchIds),
  ]);
  const activity = buildActivity({
    appId: app.id,
    scanRows,
    batchRows,
    outcomes,
    flowsFound: (id) => found.get(id) ?? 0,
    flowNames: new Map(flowNames.map((f) => [f.id, f.name])),
  });

  const busy = activity.some((r) => r.status === "queued" || r.status === "running");

  return (
    <div className="page">
      {busy && <AutoRefresh every={4000} />}
      <PageHeader title="Runs" description="Discovery scans and replays of your saved flows, newest first." />
      {activity.length === 0 ? (
        <Empty title="Nothing has run yet">
          <p className="mb-4">Start a scan, or run your flows from the Flows tab.</p>
          <Button asChild>
            <Link href={`/new?app=${app.id}`}>Start a scan</Link>
          </Button>
        </Empty>
      ) : (
        <ItemList>
          {activity.map((a) => (
            <ActivityItem key={a.id} a={a} />
          ))}
        </ItemList>
      )}
    </div>
  );
}
