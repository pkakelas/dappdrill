import "server-only";
import { EDGE_CASES, SEVERITY_ORDER, type EdgeCaseId } from "@dappdrill/core";
import { db, flows, issues, runs, signingReviews } from "@dappdrill/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { CellKind } from "@/components/ui";
import type { FlowRow, IssueRow, RunRow } from "./queries";

export type ReviewRow = typeof signingReviews.$inferSelect;

export interface Results {
  flows: FlowRow[];
  runs: RunRow[];
  issues: IssueRow[];
  reviews: ReviewRow[];
}

/** Everything a scan or a run batch produced. */
export async function loadResults(by: { scanId: string } | { batchId: string }): Promise<Results> {
  const runWhere = "scanId" in by ? eq(runs.scanId, by.scanId) : eq(runs.batchId, by.batchId);
  const issueWhere = "scanId" in by ? eq(issues.scanId, by.scanId) : eq(issues.batchId, by.batchId);
  const reviewWhere = "scanId" in by ? eq(signingReviews.scanId, by.scanId) : eq(signingReviews.batchId, by.batchId);
  const [runRows, issueRows, reviewRows] = await Promise.all([
    db().select().from(runs).where(runWhere).orderBy(asc(runs.createdAt)),
    db().select().from(issues).where(issueWhere),
    db().select().from(signingReviews).where(reviewWhere).orderBy(asc(signingReviews.createdAt)),
  ]);
  const flowIds = [...new Set(runRows.map((r) => r.flowId).filter((x): x is string => Boolean(x)))];
  const flowWhere = "scanId" in by ? (flowIds.length ? or(eq(flows.scanId, by.scanId), inArray(flows.id, flowIds)) : eq(flows.scanId, by.scanId)) : inArray(flows.id, flowIds.length ? flowIds : ["-"]);
  const flowRows = await db().select().from(flows).where(flowWhere).orderBy(asc(flows.createdAt));
  issueRows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.createdAt.getTime() - b.createdAt.getTime());
  return { flows: flowRows, runs: runRows, issues: issueRows, reviews: reviewRows };
}

/** Problems drive the cell colour: a dangerous signing review beats a plain issue. */
export function cellKind(run: RunRow, r: Pick<Results, "issues" | "reviews">): CellKind {
  if (run.status === "pass") return "pass";
  if (run.status === "issue") {
    const reviewIds = new Set(run.result.signingReviewIds);
    const dangerous = r.reviews.some((v) => v.verdict === "dangerous" && (reviewIds.has(v.data.id) || reviewIds.has(v.id)));
    const own = r.issues.filter((i) => i.runId === run.id || run.result.issueIds.includes(i.data.id));
    if (dangerous || own.some((i) => i.category === "signing" && (i.severity === "critical" || i.severity === "high"))) return "signing";
    return own.some((i) => i.severity === "critical" || i.severity === "high") ? "issue-high" : "issue";
  }
  return run.status;
}

export interface Matrix {
  edgeCases: EdgeCaseId[];
  rows: { flowId: string; name: string; cells: Partial<Record<EdgeCaseId, { runId: string; kind: CellKind }>> }[];
}

export function buildMatrix(r: Results): Matrix {
  const present = new Set(r.runs.map((x) => x.edgeCase));
  const edgeCases = EDGE_CASES.map((e) => e.id).filter((id) => present.has(id));
  const names = new Map(r.flows.map((f) => [f.id, f.name]));
  const rows = new Map<string, Matrix["rows"][number]>();
  for (const run of r.runs) {
    const flowId = run.flowId ?? run.result.flowId;
    const row = rows.get(flowId) ?? { flowId, name: names.get(flowId) ?? "Deleted flow", cells: {} };
    row.cells[run.edgeCase] = { runId: run.id, kind: cellKind(run, r) }; // later runs win
    rows.set(flowId, row);
  }
  const order = new Map(r.flows.map((f, i) => [f.id, i]));
  return { edgeCases, rows: [...rows.values()].sort((a, b) => (order.get(a.flowId) ?? 1e9) - (order.get(b.flowId) ?? 1e9)) };
}

export function summarize(r: Results) {
  const open = r.issues.filter((i) => i.status === "open");
  const attention = open.filter((i) => i.severity === "critical" || i.severity === "high");
  const worth = open.filter((i) => i.severity === "medium");
  const flowIds = new Set(r.runs.map((x) => x.flowId ?? x.result.flowId));
  const failing = new Set(r.runs.filter((x) => x.status !== "pass" && x.status !== "skipped").map((x) => x.flowId ?? x.result.flowId));
  const signRequests = r.runs.reduce((n, x) => n + x.result.walletRequests.filter((w) => w.kind === "sign").length, 0);
  // A flow that broke without filing an issue (replays often don't) still needs attention.
  const covered = new Set(r.issues.flatMap((i) => (i.runId ? [i.runId] : [])));
  const brokenRuns = r.runs.filter((x) => x.status === "fail" && !covered.has(x.id) && x.result.issueIds.length === 0);
  return {
    open,
    attention,
    brokenRuns,
    needCount: attention.length + brokenRuns.length,
    worth,
    flowCount: Math.max(flowIds.size, r.flows.length),
    cleanFlows: [...flowIds].filter((id) => !failing.has(id)).length,
    edgeCasesTried: r.runs.filter((x) => x.edgeCase !== "happy" && x.status !== "skipped").length,
    reviewCount: r.reviews.length || signRequests,
  };
}

/** Load a single result for a side panel, scoped to the app. */
export async function loadPanel(appId: string, panel: string | undefined) {
  if (!panel) return null;
  const [kind, id] = panel.split(".", 2) as [string, string | undefined];
  if (!id) return null;
  if (kind === "issue") {
    const [row] = await db().select().from(issues).where(and(eq(issues.id, id), eq(issues.appId, appId)));
    return row ? ({ kind: "issue", row } as const) : null;
  }
  if (kind === "run") {
    const [row] = await db().select().from(runs).where(and(eq(runs.id, id), eq(runs.appId, appId)));
    return row ? ({ kind: "run", row } as const) : null;
  }
  if (kind === "review") {
    const [row] = await db().select().from(signingReviews).where(and(eq(signingReviews.id, id), eq(signingReviews.appId, appId)));
    return row ? ({ kind: "review", row } as const) : null;
  }
  return null;
}
export type PanelData = NonNullable<Awaited<ReturnType<typeof loadPanel>>>;
