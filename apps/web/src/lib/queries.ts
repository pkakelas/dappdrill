import "server-only";
import { healthOfIssues, SEVERITY_ORDER, type Health, type Severity } from "@dappdrill/core";
import { apps, db, flows, integrations, issues, runBatches, runs, scans } from "@dappdrill/db";
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

export type ScanRow = typeof scans.$inferSelect;
export type IssueRow = typeof issues.$inferSelect;
export type BatchRow = typeof runBatches.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type FlowRow = typeof flows.$inferSelect;

/** Severity counts of open issues per scan or batch. For batches a failed run counts as a high issue, since replay failures don't always file one. */
export async function issueCounts(by: "scan" | "batch", ids: string[]): Promise<Map<string, Record<Severity, number>>> {
  const out = new Map<string, Record<Severity, number>>();
  if (ids.length === 0) return out;
  const col = by === "scan" ? issues.scanId : issues.batchId;
  const rows = await db()
    .select({ id: col, severity: issues.severity, n: count() })
    .from(issues)
    .where(and(inArray(col, ids), eq(issues.status, "open")))
    .groupBy(col, issues.severity);
  for (const r of rows) {
    if (!r.id) continue;
    const c = out.get(r.id) ?? { critical: 0, high: 0, medium: 0, low: 0 };
    c[r.severity] += r.n;
    out.set(r.id, c);
  }
  if (by === "batch") {
    const failed = await db()
      .select({ id: runs.batchId, n: count() })
      .from(runs)
      .where(and(inArray(runs.batchId, ids), eq(runs.status, "fail")))
      .groupBy(runs.batchId);
    for (const r of failed) {
      if (!r.id) continue;
      const c = out.get(r.id) ?? { critical: 0, high: 0, medium: 0, low: 0 };
      c.high += r.n;
      out.set(r.id, c);
    }
  }
  return out;
}

export function healthOfCounts(c?: Record<Severity, number>): Health {
  if (!c) return "ok";
  return healthOfIssues([
    ...Array(c.critical + c.high).fill({ severity: "high" as const }),
    ...Array(c.medium + c.low).fill({ severity: "medium" as const }),
  ]);
}

export async function flowCountsByScan(scanIds: string[]): Promise<Map<string, number>> {
  if (scanIds.length === 0) return new Map();
  const rows = await db()
    .select({ id: flows.scanId, n: count() })
    .from(flows)
    .where(inArray(flows.scanId, scanIds))
    .groupBy(flows.scanId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}

export async function recentScans(teamId: string, limit = 8) {
  return db()
    .select({ scan: scans, appName: apps.name, appUrl: apps.url })
    .from(scans)
    .innerJoin(apps, eq(apps.id, scans.appId))
    .where(eq(apps.teamId, teamId))
    .orderBy(desc(scans.createdAt))
    .limit(limit);
}

export async function latestScan(appId: string, finished = false): Promise<ScanRow | undefined> {
  const [row] = await db()
    .select()
    .from(scans)
    .where(and(eq(scans.appId, appId), finished ? inArray(scans.status, ["done", "stopped"]) : undefined))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  return row;
}

/** How many issues later replays found fixed since the given time. */
export async function fixedSince(appId: string, since: Date | undefined): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(issues)
    .where(and(eq(issues.appId, appId), eq(issues.status, "fixed"), since ? gt(issues.fixedAt, since) : undefined));
  return row?.n ?? 0;
}

/**
 * Open issues for the app right now: the latest finished scan plus any run batch
 * after it, newest first, one per fingerprint.
 */
export async function openIssues(appId: string): Promise<IssueRow[]> {
  const scan = await latestScan(appId, true);
  const since = scan?.createdAt ?? new Date(0);
  const rows = await db()
    .select({ issue: issues })
    .from(issues)
    .leftJoin(runBatches, eq(runBatches.id, issues.batchId))
    .where(
      and(
        eq(issues.appId, appId),
        eq(issues.status, "open"),
        or(scan ? eq(issues.scanId, scan.id) : sql`false`, and(isNull(issues.scanId), gt(runBatches.createdAt, since))),
      ),
    )
    .orderBy(desc(issues.createdAt));
  const seen = new Set<string>();
  const out: IssueRow[] = [];
  for (const { issue } of rows) {
    if (seen.has(issue.fingerprint)) continue;
    seen.add(issue.fingerprint);
    out.push(issue);
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Last N run statuses per flow (oldest first), for sparkbars. */
export async function recentStatuses(flowIds: string[], n = 10) {
  const out = new Map<string, RunRow["status"][]>();
  if (flowIds.length === 0) return out;
  const rows = await db().execute<{ flow_id: string; status: RunRow["status"] }>(sql`
    select flow_id, status from (
      select flow_id, status, created_at, row_number() over (partition by flow_id order by created_at desc) as rn
      from ${runs} where ${inArray(runs.flowId, flowIds)} and edge_case = 'happy'
    ) t where rn <= ${n} order by created_at asc`);
  for (const r of rows) {
    const list = out.get(r.flow_id) ?? [];
    list.push(r.status);
    out.set(r.flow_id, list);
  }
  return out;
}

export async function githubRepo(teamId: string): Promise<string | null> {
  const [row] = await db()
    .select({ config: integrations.config, enabled: integrations.enabled })
    .from(integrations)
    .where(and(eq(integrations.teamId, teamId), eq(integrations.kind, "github")));
  return row?.enabled && row.config.repo ? row.config.repo : null;
}

/** Most recent run per flow (any edge case). */
export async function lastRuns(flowIds: string[]) {
  const out = new Map<string, { status: RunRow["status"]; at: Date }>();
  if (flowIds.length === 0) return out;
  const rows = await db().execute<{ flow_id: string; status: RunRow["status"]; created_at: string }>(sql`
    select distinct on (flow_id) flow_id, status, created_at from ${runs}
    where ${inArray(runs.flowId, flowIds)} and edge_case = 'happy' order by flow_id, created_at desc`);
  for (const r of rows) out.set(r.flow_id, { status: r.status, at: new Date(r.created_at) });
  return out;
}

/** For each scan or run batch: issues seen for the first time, and issues its runs confirmed fixed. */
export type Outcome = {
  fresh: number;
  fixed: number;
  /** The most severe issue this scan or replay found first, for a one-line preview. */
  topNew?: { title: string; severity: Severity };
  topFixed?: { title: string };
};

/** What each scan or replay batch changed: issues seen for the first time, and issues it confirmed fixed. */
export async function activityOutcomes(scanIds: string[], batchIds: string[]) {
  const out = new Map<string, Outcome>();
  const ids = [...scanIds, ...batchIds];
  if (ids.length === 0) return out;
  const rank = sql`case i.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;
  const [found, fixed] = await Promise.all([
    db().execute<{ owner: string; n: number; title: string; severity: Severity }>(sql`
      select distinct on (owner) owner, count(*) over (partition by owner)::int as n, title, severity from (
        select coalesce(i.scan_id, i.batch_id) as owner, i.title, i.severity, ${rank} as rank, i.created_at from ${issues} i
        where (i.scan_id in ${ids} or i.batch_id in ${ids})
          and not exists (select 1 from ${issues} e where e.app_id = i.app_id and e.fingerprint = i.fingerprint and e.created_at < i.created_at)
      ) f
      order by owner, rank, created_at`),
    db().execute<{ owner: string; n: number; title: string }>(sql`
      select distinct on (owner) owner, count(*) over (partition by owner)::int as n, title from (
        select coalesce(r.scan_id, r.batch_id) as owner, i.title, ${rank} as rank from ${issues} i
        join ${runs} r on r.id = i.fixed_by_run_id
        where r.scan_id in ${ids} or r.batch_id in ${ids}
      ) f
      order by owner, rank`),
  ]);
  for (const id of ids) out.set(id, { fresh: 0, fixed: 0 });
  for (const r of found) Object.assign(out.get(r.owner)!, { fresh: r.n, topNew: { title: r.title, severity: r.severity } });
  for (const r of fixed) Object.assign(out.get(r.owner)!, { fixed: r.n, topFixed: { title: r.title } });
  return out;
}

/** The newest end-of-flow screenshot of the dApp, from a happy-path run that passed. */
export async function latestScreenshot(appId: string) {
  const [row] = await db()
    .select({ scanId: runs.scanId, batchId: runs.batchId, path: sql<string>`${runs.result}->>'finalScreenshot'` })
    .from(runs)
    .where(and(eq(runs.appId, appId), eq(runs.edgeCase, "happy"), eq(runs.status, "pass"), sql`${runs.result}->>'finalScreenshot' is not null`))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return row;
}
