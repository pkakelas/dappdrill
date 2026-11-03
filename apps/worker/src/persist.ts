import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Flow, FlowRun, Issue, SigningReview } from "@dappdrill/core";
import { flows, issues, runs, signingReviews, type Db } from "@dappdrill/db";
import type { ReportInput } from "@dappdrill/cli";
import { errorMessage, type Logger } from "./log.js";

export interface Owner {
  appId: string;
  scanId?: string;
  batchId?: string;
}

/**
 * Writes engine results for one scan or batch. Idempotent (engine ids are the row ids),
 * so streamed events and the final report can both be written without duplicates.
 * Artifact paths are stored as the engine reports them (relative to the job's artifacts dir).
 */
export class Persister {
  /** Flow ids that exist as rows; anything else is stored with flow_id null (FK). */
  private readonly knownFlows: Set<string>;
  /** What this job wrote, for notifications and the summary. */
  readonly written = { flows: new Map<string, Flow>(), runs: new Map<string, FlowRun>(), issues: new Map<string, Issue>(), reviews: new Map<string, SigningReview>() };
  /** Ids of issues written as ignored ("This is expected" earlier). */
  readonly ignored = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly owner: Owner,
    knownFlowIds: Iterable<string> = [],
  ) {
    this.knownFlows = new Set(knownFlowIds);
  }

  private flowRef(id: string | undefined): string | null {
    return id && this.knownFlows.has(id) ? id : null;
  }

  /** Discovered flows: flows.id is the engine's flow id. A flow id owned by another app is left alone. */
  async flow(flow: Flow): Promise<void> {
    const now = new Date();
    const rows = await this.db
      .insert(flows)
      .values({ id: flow.id, appId: this.owner.appId, name: flow.name, definition: flow, scanId: this.owner.scanId ?? null })
      .onConflictDoUpdate({
        target: flows.id,
        set: { name: flow.name, definition: flow, updatedAt: now },
        setWhere: eq(flows.appId, this.owner.appId),
      })
      .returning({ id: flows.id });
    if (rows.length > 0) {
      this.knownFlows.add(flow.id);
      this.written.flows.set(flow.id, flow);
    }
  }

  async run(run: FlowRun): Promise<void> {
    await this.db
      .insert(runs)
      .values({
        id: run.id,
        appId: this.owner.appId,
        scanId: this.owner.scanId ?? null,
        batchId: this.owner.batchId ?? null,
        flowId: this.flowRef(run.flowId),
        edgeCase: run.edgeCase,
        status: run.status,
        result: run,
      })
      .onConflictDoUpdate({ target: runs.id, set: { status: run.status, result: run } });
    this.written.runs.set(run.id, run);
  }

  /** New issues stay ignored when the same fingerprint was marked "This is expected" for this app. */
  async issue(issue: Issue): Promise<void> {
    if (this.written.issues.has(issue.id)) return;
    const [ignored] = await this.db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.appId, this.owner.appId), eq(issues.fingerprint, issue.fingerprint), eq(issues.status, "ignored")))
      .limit(1);
    await this.db
      .insert(issues)
      .values({
        id: issue.id,
        appId: this.owner.appId,
        scanId: this.owner.scanId ?? null,
        batchId: this.owner.batchId ?? null,
        runId: issue.runId ?? null,
        flowId: this.flowRef(issue.flowId),
        fingerprint: issue.fingerprint,
        severity: issue.severity,
        category: issue.category,
        title: issue.title,
        data: issue,
        status: ignored ? "ignored" : "open",
      })
      .onConflictDoNothing();
    this.written.issues.set(issue.id, issue);
    if (ignored) this.ignored.add(issue.id);
  }

  async review(review: SigningReview): Promise<void> {
    await this.db
      .insert(signingReviews)
      .values({
        id: review.id,
        appId: this.owner.appId,
        scanId: this.owner.scanId ?? null,
        batchId: this.owner.batchId ?? null,
        flowId: this.flowRef(review.flowId),
        fingerprint: review.fingerprint,
        verdict: review.verdict,
        data: review,
      })
      .onConflictDoNothing();
    this.written.reviews.set(review.id, review);
  }

  summary(): string {
    const w = this.written;
    return `${w.flows.size} flows, ${w.runs.size} runs, ${w.issues.size} issues, ${w.reviews.size} signing reviews`;
  }

  /** What was written, in report shape (for notifications when there's no engine report). */
  asReport(url: string, flows: Flow[] = [...this.written.flows.values()]): ReportInput {
    const runs = [...this.written.runs.values()];
    const at = new Date().toISOString();
    return {
      url,
      startedAt: runs[0]?.startedAt ?? at,
      finishedAt: runs.at(-1)?.finishedAt ?? at,
      flows,
      runs,
      issues: [...this.written.issues.values()],
      signingReviews: [...this.written.reviews.values()],
    };
  }

  /** Write a full result set (the engine's final report), skipping nothing already written. */
  async all(result: { flows?: Flow[]; runs: FlowRun[]; issues: Issue[]; signingReviews: SigningReview[] }): Promise<void> {
    for (const f of result.flows ?? []) if (!this.written.flows.has(f.id)) await this.flow(f);
    for (const r of result.signingReviews) if (!this.written.reviews.has(r.id)) await this.review(r);
    for (const i of result.issues) if (!this.written.issues.has(i.id)) await this.issue(i);
    for (const r of result.runs) await this.run(r);
  }
}

/**
 * Close open issues that a finished run of the same flow and edge case no longer hits:
 * the run passed, or it filed issues but not this one. Returns the ids it closed.
 * Without the model (replays), issues only a model check could find stay open.
 */
export async function closeFixedIssues(db: Db, appId: string, runList: FlowRun[], found: Issue[], withModel: boolean): Promise<string[]> {
  const foundIds = found.map((i) => i.id);
  const closed: string[] = [];
  for (const run of runList) {
    // A variation runs with other inputs, so it says nothing about the flow's own issues.
    if ((run.status !== "pass" && run.status !== "issue") || run.variationId) continue;
    const still = found.filter((i) => i.runId === run.id || run.issueIds.includes(i.id)).map((i) => i.fingerprint);
    // An "issue" run that can't say what it found can't vouch for anything being fixed.
    if (run.status === "issue" && still.length === 0) continue;
    const rows = await db
      .update(issues)
      .set({ status: "fixed", fixedByRunId: run.id, fixedAt: new Date() })
      .where(
        and(
          eq(issues.appId, appId),
          eq(issues.flowId, run.flowId),
          eq(issues.status, "open"),
          sql`${issues.data}->>'edgeCase' = ${run.edgeCase}`,
          withModel ? undefined : sql`coalesce((${issues.data}->>'byModel')::boolean, false) = false`,
          foundIds.length ? notInArray(issues.id, foundIds) : undefined,
          still.length ? notInArray(issues.fingerprint, still) : undefined,
        ),
      )
      .returning({ id: issues.id });
    closed.push(...rows.map((r) => r.id));
  }
  return closed;
}

/** closeFixedIssues for everything a job wrote; logs instead of failing the job. */
export async function closeFixed(db: Db, appId: string, persister: Persister, log: Logger, withModel: boolean): Promise<void> {
  try {
    const closed = await closeFixedIssues(db, appId, [...persister.written.runs.values()], [...persister.written.issues.values()], withModel);
    if (closed.length) log.info(`marked ${closed.length} issue(s) fixed`);
  } catch (e) {
    log.warn(`could not close fixed issues: ${errorMessage(e)}`);
  }
}

/** Is this the first time we see a fingerprint for the app (outside the given issue ids)? */
export async function isNewFingerprint(db: Db, appId: string, fp: string, excludeIds: string[]): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(eq(issues.appId, appId), eq(issues.fingerprint, fp), notInArray(issues.id, excludeIds)));
  return (row?.n ?? 0) === 0;
}
