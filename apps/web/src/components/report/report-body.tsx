import { CATEGORY_LABEL, EDGE_CASES, type IssueCategory } from "@dappdrill/core";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx, StatGrid, VerdictTag } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { plural } from "@/lib/format";
import { buildMatrix, summarize, type Results } from "@/lib/report";
import type { ViewCtx } from "./ctx";
import { CriticalIssueCard, IssueRowCard } from "./issues";
import { MatrixTable } from "./matrix";

const FILTERS: ("all" | IssueCategory)[] = ["all", "signing", "wallet", "ui", "rpc"];

export function headline(s: ReturnType<typeof summarize>): string {
  if (s.needCount) return `${s.needCount} ${s.needCount === 1 ? "thing needs" : "things need"} your attention`;
  if (s.worth.length) return `Nothing broken. ${s.worth.length} worth a look`;
  if (!s.flowCount) return "Nothing tested: no flows were found";
  if (!s.runCount) return "Nothing tested: no flow was replayed";
  return "All clear";
}

/** Stats, issues with filters, signing requests and the flow × edge-case matrix. */
export function ReportBody({ results, ctx, cat, filterHref, batch }: { results: Results; ctx: ViewCtx; cat?: string; filterHref: (cat: string) => string; batch?: boolean }) {
  const s = summarize(results);
  const names = new Map(results.flows.map((f) => [f.id, f.name]));
  const filter = FILTERS.includes(cat as IssueCategory) ? (cat as IssueCategory | "all") : "all";
  const visible = s.open.filter((i) => filter === "all" || i.category === filter);
  const main = visible.filter((i) => i.severity !== "low");
  const low = visible.filter((i) => i.severity === "low");
  const ignored = results.issues.filter((i) => i.status === "ignored");
  const fixed = results.issues.filter((i) => i.status === "fixed");
  const reviewHref = (id?: string) => {
    const r = id && results.reviews.find((v) => v.id === id || v.data.id === id);
    return r ? ctx.panelHref(`review.${r.id}`) : null;
  };
  const counts = (c: IssueCategory | "all") => (c === "all" ? s.open.length : s.open.filter((i) => i.category === c).length);
  const reviews = groupReviews(results.reviews, names).sort((a, b) => ["dangerous", "check", "consistent"].indexOf(a.verdict) - ["dangerous", "check", "consistent"].indexOf(b.verdict));
  const flagged = reviews.filter((r) => r.verdict !== "consistent");
  const consistent = reviews.filter((r) => r.verdict === "consistent");

  return (
    <>
      <StatGrid
        stats={[
          { value: s.flowCount, label: batch ? "Flows run" : "Flows found" },
          { value: s.cleanFlows, label: "Flows pass every case" },
          { value: s.needCount, label: "Need attention", tone: s.needCount ? "bad" : undefined },
          { value: s.worth.length, label: "Worth a look", tone: s.worth.length ? "warn" : undefined },
        ]}
      />

      <section aria-labelledby="issues" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="issues" className="text-lg font-semibold">
            Issues
          </h2>
          {s.open.length > 0 && (
            <nav className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px]" aria-label="Filter issues">
              {FILTERS.filter((c) => c === "all" || c !== "rpc" || counts("rpc") > 0).map((c) => (
                <Link
                  key={c}
                  href={filterHref(c)}
                  scroll={false}
                  aria-current={filter === c}
                  replace
                  className={cx(
                    "flex h-full items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                    filter === c ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c === "all" ? "All" : CATEGORY_LABEL[c]}
                  <span className="text-xs text-muted-foreground">{counts(c)}</span>
                </Link>
              ))}
            </nav>
          )}
        </div>
        {filter === "all" &&
          s.brokenRuns.map((run) => {
            const edge = EDGE_CASES.find((e) => e.id === run.edgeCase)?.label ?? run.edgeCase;
            return (
              <Link key={run.id} href={ctx.panelHref(`run.${run.id}`)} scroll={false} className="group flex items-center gap-4 rounded-xl border bg-card px-5 py-4 shadow-xs hover:bg-muted/50">
                <article className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-md bg-bad-bg text-bad">
                      Failed
                    </Badge>
                    <span className="text-muted-foreground">
                      {names.get(run.flowId ?? run.result.flowId) ?? "Flow"} · {edge}
                    </span>
                  </div>
                  <h3 className="font-medium">{run.result.reason ?? "The flow didn't finish"}</h3>
                </article>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-label="Watch run" />
              </Link>
            );
          })}
        {visible.length === 0 && s.brokenRuns.length === 0 && <p className="rounded-xl border border-dashed px-5 py-6 text-center text-muted-foreground">{s.open.length ? "No issues in this category." : "No issues found."}</p>}
        {main.map((i) =>
          i.severity === "critical" ? (
            <CriticalIssueCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} reviewHref={reviewHref(i.data.evidence.signingReviewId)} />
          ) : (
            <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
          ),
        )}
        {low.length > 0 && (
          <More label={`Show ${low.length} low-severity ${low.length === 1 ? "issue" : "issues"}`}>
            {low.map((i) => (
              <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
            ))}
          </More>
        )}
        {ignored.length > 0 && (
          <More label={`${ignored.length} marked as expected`}>
            {ignored.map((i) => (
              <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
            ))}
          </More>
        )}
        {fixed.length > 0 && (
          <More label={`${fixed.length} fixed since`}>
            {fixed.map((i) => (
              <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
            ))}
          </More>
        )}
      </section>

      {reviews.length > 0 && (
        <section aria-labelledby="signing" className="flex flex-col gap-3">
          <h2 id="signing" className="text-lg font-semibold">
            Signature requests
          </h2>
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {flagged.map((r) => (
              <ReviewLine key={r.id} review={r} ctx={ctx} />
            ))}
            {flagged.length === 0 && <li className="px-5 py-3.5 text-muted-foreground">Every request matched what the page said.</li>}
          </ul>
          {consistent.length > 0 && (
            <More label={`${plural(consistent.reduce((n, r) => n + r.count, 0), "request")} looked consistent`}>
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {consistent.map((r) => (
                  <ReviewLine key={r.id} review={r} ctx={ctx} />
                ))}
              </ul>
            </More>
          )}
        </section>
      )}

      <section aria-labelledby="matrix" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="matrix" className="text-lg font-semibold">
            Every flow, every edge case
          </h2>
          <p className="text-muted-foreground">Each cell is one run. Click a cell to watch it.</p>
        </div>
        <MatrixTable matrix={buildMatrix(results)} ctx={ctx} />
      </section>
    </>
  );
}

type Verdict = Results["reviews"][number]["verdict"];

interface ReviewGroup {
  id: string;
  title: string;
  verdict: Verdict;
  count: number;
  flows: string[];
}

/** Replays repeat the same request; show each distinct request (by fingerprint and verdict) once. */
function groupReviews(rows: Results["reviews"], names: Map<string, string>): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const r of rows) {
    const key = `${r.fingerprint}:${r.verdict}`;
    const g = groups.get(key) ?? { id: r.id, title: r.data.title, verdict: r.verdict, count: 0, flows: [] };
    const flow = r.flowId ? names.get(r.flowId) : undefined;
    if (flow && !g.flows.includes(flow)) g.flows.push(flow);
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()];
}

function ReviewLine({ review: r, ctx }: { review: ReviewGroup; ctx: ViewCtx }) {
  return (
    <li>
      <Link href={ctx.panelHref(`review.${r.id}`)} scroll={false} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-muted/50">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">
            {r.title}
            {r.count > 1 && <span className="font-normal text-muted-foreground"> · {r.count} times</span>}
          </span>
          {r.flows.length > 0 && <span className="text-xs text-muted-foreground">{r.flows.join(", ")}</span>}
        </span>
        <VerdictTag verdict={r.verdict} />
      </Link>
    </li>
  );
}

/** A quiet "show more" disclosure. */
function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex w-fit items-center gap-1.5 text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  );
}
