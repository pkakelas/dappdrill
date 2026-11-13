import { VERDICT_LABEL, type SigningReview, type Verdict } from "@dappdrill/core";
import { ChevronRight } from "lucide-react";
import { Addr, cx } from "@/components/ui";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const VERDICT_TEXT: Record<Verdict, string> = { dangerous: "text-bad", check: "text-warn", consistent: "text-muted-foreground" };
const VERDICT_DOT: Record<Verdict, string> = { dangerous: "bg-bad-mid", check: "bg-warn-bar", consistent: "bg-foreground/30" };

/** What the wallet was asked to sign during a run, each with its review folded under it. */
export function SigningReviews({ reviews }: { reviews: SigningReview[] }) {
  if (reviews.length === 0) return null;
  return (
    <section aria-label="Signed in the wallet" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 px-2">
        <h2 className="text-sm font-medium">Signed in the wallet</h2>
        <span className="text-xs text-muted-foreground">{reviews.length === 1 ? "1 request" : `${reviews.length} requests`}, each reviewed</span>
      </div>
      <ul className="divide-y rounded-xl border bg-card shadow-xs">
        {reviews.map((review) => (
          <li key={review.id}>
            <Review review={review} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A signature: what it does and the verdict, the evidence folded away. */
function Review({ review }: { review: SigningReview }) {
  const d = review.decoded;
  const flagged = review.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl px-4 py-3 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="leading-snug font-medium">{review.title}</span>
            <span className={cx("flex items-center gap-1.5 text-xs font-medium", VERDICT_TEXT[review.verdict])}>
              <span aria-hidden="true" className={cx("size-1.5 rounded-full", VERDICT_DOT[review.verdict])} />
              {VERDICT_LABEL[review.verdict]}
            </span>
          </span>
          <span className="text-sm leading-snug text-pretty text-muted-foreground [overflow-wrap:anywhere]">{review.summary}</span>
        </span>
      </summary>
      <div className="pr-4 pb-4 pl-10">
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
