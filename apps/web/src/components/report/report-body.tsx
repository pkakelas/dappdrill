import { CATEGORY_LABEL, EDGE_CASES, type IssueCategory } from "@dappdrill/core";
import Link from "next/link";
import { PlayIcon, StatGrid, VerdictTag } from "@/components/ui";
import { buildMatrix, summarize, type Results } from "@/lib/report";
import type { ViewCtx } from "./ctx";
import { CriticalIssueCard, IssueRowCard } from "./issues";
import { MatrixTable } from "./matrix";

const FILTERS: ("all" | IssueCategory)[] = ["all", "signing", "wallet", "ui", "rpc"];

export function headline(s: ReturnType<typeof summarize>): string {
  if (s.needCount) return `${s.needCount} ${s.needCount === 1 ? "thing needs" : "things need"} your attention`;
  if (s.worth.length) return `Nothing broken. ${s.worth.length} worth a look`;
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
  const ignored = results.issues.filter((i) => i.status !== "open");
  const reviewHref = (id?: string) => {
    const r = id && results.reviews.find((v) => v.id === id || v.data.id === id);
    return r ? ctx.panelHref(`review.${r.id}`) : null;
  };
  const counts = (c: IssueCategory | "all") => (c === "all" ? s.open.length : s.open.filter((i) => i.category === c).length);
  const reviews = [...results.reviews].sort((a, b) => ["dangerous", "check", "consistent"].indexOf(a.verdict) - ["dangerous", "check", "consistent"].indexOf(b.verdict));
  const flagged = reviews.filter((r) => r.verdict !== "consistent");
  const consistent = reviews.filter((r) => r.verdict === "consistent");

  return (
    <>
      <StatGrid
        stats={[
          { value: s.flowCount, label: batch ? "flows run" : "flows found" },
          { value: s.cleanFlows, label: "flows pass every case" },
          { value: s.needCount, label: "need attention", tone: s.needCount ? "bad" : undefined },
          { value: s.worth.length, label: "worth a look", tone: s.worth.length ? "warn" : undefined },
        ]}
      />

      <section aria-labelledby="issues" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="issues" className="h2">
            Issues
          </h2>
          {s.open.length > 0 && (
            <div className="seg" role="group" aria-label="Filter issues">
              {FILTERS.filter((c) => c === "all" || c !== "rpc" || counts("rpc") > 0).map((c) => (
                <Link key={c} href={filterHref(c)} scroll={false} aria-current={filter === c} replace>
                  {c === "all" ? "All" : CATEGORY_LABEL[c]} {counts(c)}
                </Link>
              ))}
            </div>
          )}
        </div>
        {filter === "all" &&
          s.brokenRuns.map((run) => {
            const edge = EDGE_CASES.find((e) => e.id === run.edgeCase)?.label ?? run.edgeCase;
            return (
              <article key={run.id} className="card flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
                <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="tag bg-bad-bg text-bad">Failed</span>
                    <span className="text-[13px] text-muted">
                      {names.get(run.flowId ?? run.result.flowId) ?? "Flow"} · {edge}
                    </span>
                  </div>
                  <h3 className="m-0 text-base font-semibold">
                    <Link href={ctx.panelHref(`run.${run.id}`)} scroll={false} className="no-underline hover:underline">
                      {run.result.reason ?? "The flow didn't finish"}
                    </Link>
                  </h3>
                </div>
                <Link href={ctx.panelHref(`run.${run.id}`)} scroll={false} className="btn btn-sm">
                  <PlayIcon />
                  Watch run
                </Link>
              </article>
            );
          })}
        {visible.length === 0 && s.brokenRuns.length === 0 && <p className="m-0 rounded-xl border border-line bg-white px-5 py-4 text-sm text-muted">{s.open.length ? "No issues in this category." : "No issues found."}</p>}
        {main.map((i) =>
          i.severity === "critical" ? (
            <CriticalIssueCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} reviewHref={reviewHref(i.data.evidence.signingReviewId)} />
          ) : (
            <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
          ),
        )}
        {low.length > 0 && (
          <details className="flex flex-col gap-3">
            <summary className="btn-link w-fit text-sm text-muted">Show {low.length} low-severity {low.length === 1 ? "issue" : "issues"}</summary>
            <div className="mt-3 flex flex-col gap-3">
              {low.map((i) => (
                <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
              ))}
            </div>
          </details>
        )}
        {ignored.length > 0 && (
          <details>
            <summary className="btn-link w-fit text-sm text-muted">{ignored.length} marked as expected</summary>
            <div className="mt-3 flex flex-col gap-3">
              {ignored.map((i) => (
                <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
              ))}
            </div>
          </details>
        )}
      </section>

      {reviews.length > 0 && (
        <section aria-labelledby="signing" className="flex flex-col gap-3">
          <h2 id="signing" className="h2">
            Signature requests
          </h2>
          <ul className="card m-0 list-none divide-y divide-divide p-0">
            {flagged.map((r) => (
              <ReviewLine key={r.id} id={r.id} title={r.data.title} flow={r.flowId ? names.get(r.flowId) : undefined} verdict={r.verdict} ctx={ctx} />
            ))}
            {flagged.length === 0 && <li className="px-5 py-3.5 text-sm text-muted">Every request matched what the page said.</li>}
          </ul>
          {consistent.length > 0 && (
            <details>
              <summary className="btn-link w-fit text-sm text-muted">{consistent.length} looked consistent</summary>
              <ul className="card m-0 mt-3 list-none divide-y divide-divide p-0">
                {consistent.map((r) => (
                  <ReviewLine key={r.id} id={r.id} title={r.data.title} flow={r.flowId ? names.get(r.flowId) : undefined} verdict={r.verdict} ctx={ctx} />
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section aria-labelledby="matrix" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="matrix" className="h2">
            Every flow, every edge case
          </h2>
          <p className="hint m-0">Each cell is one run. Click a cell to watch it.</p>
        </div>
        <MatrixTable matrix={buildMatrix(results)} ctx={ctx} />
      </section>
    </>
  );
}

function ReviewLine({ id, title, flow, verdict, ctx }: { id: string; title: string; flow?: string; verdict: "dangerous" | "check" | "consistent"; ctx: ViewCtx }) {
  return (
    <li>
      <Link href={ctx.panelHref(`review.${id}`)} scroll={false} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 no-underline hover:bg-sub">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{title}</span>
          {flow && <span className="text-[13px] text-muted">{flow}</span>}
        </span>
        <VerdictTag verdict={verdict} />
      </Link>
    </li>
  );
}
