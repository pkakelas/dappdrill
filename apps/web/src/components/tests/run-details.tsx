import type { SigningReview } from "@dappdrill/core";
import { ChevronDown } from "lucide-react";
import { Addr, cx, VerdictTag } from "@/components/ui";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** What the wallet was asked to sign during a run, each with its review. */
export function SigningReviews({ reviews }: { reviews: SigningReview[] }) {
  if (reviews.length === 0) return null;
  return (
    <Panel title="Signatures" count={reviews.length}>
      <ul className="divide-y">
        {reviews.map((review) => (
          <li key={review.id}>
            <Review review={review} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** A signature: the verdict at a glance, the evidence folded away. */
function Review({ review, outcome }: { review: SigningReview; outcome?: React.ReactNode }) {
  const d = review.decoded;
  const flagged = review.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <span className="leading-snug font-medium">{review.title}</span>
        <span className="flex items-center gap-2">
          {outcome}
          <VerdictTag verdict={review.verdict} />
        </span>
        <span className="text-sm leading-snug text-muted-foreground">{review.summary}</span>
        <ChevronDown className="size-4 self-end justify-self-end text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-4 pb-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 rounded-lg bg-muted/50 p-3 text-sm">
          {d.to && (
            <Row label="Contract">
              {d.contractName && <span className="mr-2">{d.contractName}</span>}
              <Addr value={d.to} className="text-xs text-muted-foreground" />
            </Row>
          )}
          {d.functionName && (
            <Row label="Call">
              <span className="font-mono text-xs break-all">
                {d.functionName}({d.args.map((a) => a.display ?? a.value).join(", ")})
              </span>
            </Row>
          )}
          {d.message && (
            <Row label="Message">
              <span className="font-mono text-xs break-all whitespace-pre-wrap">{d.message}</span>
            </Row>
          )}
          {review.simulation?.balanceChanges.map((b, i) => (
            <Row key={i} label={i === 0 ? "Balance" : ""}>
              {b.display}
            </Row>
          ))}
          {review.approvals.map((a, i) => (
            <Row key={i} label={i === 0 ? "Grants" : ""}>
              <span className={cx(a.unlimited && "text-warn")}>{a.display}</span>
            </Row>
          ))}
          {flagged.map((c) => (
            <Row key={c.id} label={c.label}>
              <span className={c.status === "fail" ? "text-bad" : "text-warn"}>{c.detail}</span>
            </Row>
          ))}
          <Row label="Why">
            <span className="leading-snug text-muted-foreground">{review.explanation}</span>
          </Row>
        </dl>
      </div>
    </details>
  );
}

export function Panel({ title, count, children, aside }: { title: string; count?: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-sm font-medium text-muted-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 font-normal tabular-nums">{count}</span>}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
