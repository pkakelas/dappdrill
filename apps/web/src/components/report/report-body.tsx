import { CATEGORY_LABEL, EDGE_CASES, type IssueCategory } from "@dappdrill/core";
import Link from "next/link";
import { Blank, Cell, List, ListRow, PlayIcon, Reveal, Section, StatGrid, VerdictTag } from "@/components/ui";
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
  const ignored = results.issues.filter((i) => i.status !== "open");
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
          { value: s.flowCount, label: batch ? "flows run" : "flows found" },
          { value: s.cleanFlows, label: "flows pass every case" },
          { value: s.needCount, label: "need attention", tone: s.needCount ? "bad" : undefined },
          { value: s.worth.length, label: "worth a look", tone: s.worth.length ? "warn" : undefined },
        ]}
      />

      <Section
        title="Issues"
        action={
          s.open.length > 0 && (
            <nav className="seg" aria-label="Filter issues">
              {FILTERS.filter((c) => c === "all" || c !== "rpc" || counts("rpc") > 0).map((c) => (
                <Link key={c} href={filterHref(c)} scroll={false} aria-current={filter === c ? "true" : undefined} replace>
                  {c === "all" ? "All" : CATEGORY_LABEL[c]}
                  <span className="count">{counts(c)}</span>
                </Link>
              ))}
            </nav>
          )
        }
      >
        {filter === "all" &&
          s.brokenRuns.map((run) => {
            const edge = EDGE_CASES.find((e) => e.id === run.edgeCase)?.label ?? run.edgeCase;
            return (
              <article key={run.id} className="card relative flex flex-wrap items-center gap-4 px-5 py-4 transition-colors has-[.stretched:hover]:bg-sub sm:px-6">
                <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Cell kind="fail" />
                    <span className="meta">
                      {names.get(run.flowId ?? run.result.flowId) ?? "Flow"} · {edge}
                    </span>
                  </div>
                  <h3 className="m-0 text-lead font-medium">
                    <Link href={ctx.panelHref(`run.${run.id}`)} scroll={false} className="stretched no-underline">
                      {run.result.reason ?? "The flow didn't finish"}
                    </Link>
                  </h3>
                </div>
                <span className="meta flex items-center gap-1.5" aria-hidden="true">
                  <PlayIcon />
                  Watch run
                </span>
              </article>
            );
          })}
        {visible.length === 0 && s.brokenRuns.length === 0 && <Blank>{s.open.length ? "No issues in this category." : "No issues found."}</Blank>}
        {main.map((i) =>
          i.severity === "critical" ? (
            <CriticalIssueCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} reviewHref={reviewHref(i.data.evidence.signingReviewId)} />
          ) : (
            <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
          ),
        )}
        {low.length > 0 && (
          <Reveal label={`Show ${plural(low.length, "low-severity issue")}`}>
            {low.map((i) => (
              <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
            ))}
          </Reveal>
        )}
        {ignored.length > 0 && (
          <Reveal label={`${ignored.length} marked as expected`}>
            {ignored.map((i) => (
              <IssueRowCard key={i.id} issue={i} ctx={ctx} flowName={i.flowId ? names.get(i.flowId) : undefined} />
            ))}
          </Reveal>
        )}
      </Section>

      {reviews.length > 0 && (
        <Section title="Signature requests" hint="Each distinct request the dApp asked the wallet to sign, worst first.">
          {flagged.length > 0 ? (
            <List>
              {flagged.map((r) => (
                <ReviewLine key={r.id} review={r} ctx={ctx} />
              ))}
            </List>
          ) : (
            <Blank>Every request matched what the page said.</Blank>
          )}
          {consistent.length > 0 && (
            <Reveal label={`${plural(consistent.reduce((n, r) => n + r.count, 0), "request")} looked consistent`}>
              <List>
                {consistent.map((r) => (
                  <ReviewLine key={r.id} review={r} ctx={ctx} />
                ))}
              </List>
            </Reveal>
          )}
        </Section>
      )}

      <Section id="matrix" title="Every flow, every edge case" hint="Each cell is one run. Click a cell to watch it.">
        <MatrixTable matrix={buildMatrix(results)} ctx={ctx} />
      </Section>
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
    <ListRow
      href={ctx.panelHref(`review.${r.id}`)}
      scroll={false}
      title={
        <>
          {r.title}
          {r.count > 1 && <span className="font-normal text-muted"> · {r.count} times</span>}
        </>
      }
      meta={r.flows.length > 0 ? r.flows.join(", ") : undefined}
      aside={<VerdictTag verdict={r.verdict} />}
    />
  );
}
