import type { SigningReview, TestRunResult, WalletRequest } from "@dappdrill/core";
import { ChevronDown } from "lucide-react";
import { Addr, cx, SeverityTag, VerdictTag } from "@/components/ui";

const METHOD_LABEL: Record<string, string> = {
  eth_requestAccounts: "Connect",
  eth_accounts: "Read accounts",
  wallet_switchEthereumChain: "Switch network",
  wallet_addEthereumChain: "Add network",
  eth_sendTransaction: "Send transaction",
  personal_sign: "Sign message",
  eth_signTypedData_v4: "Sign typed data",
  wallet_sendCalls: "Send calls",
};

const OUTCOME_LABEL: Record<WalletRequest["outcome"], string> = { approved: "Approved", rejected: "Rejected", errored: "Errored", pending: "Pending" };

/** What the app asked the wallet for, with the signing review of each signature. */
export function WalletActivity({ result }: { result: TestRunResult }) {
  const asked = result.walletRequests.filter((r) => r.kind !== "other");
  // On a live chain the app's own embedded wallet may have signed instead of ours, so the review has nothing to say.
  const embedded = result.embeddedSigner && result.signingReviews.length === 0 && <p className="px-4 py-3 text-sm text-pretty text-muted-foreground">The app&apos;s own wallet signed for this run, so there was nothing for our wallet to review.</p>;
  if (asked.length === 0) return embedded ? <Panel title="Wallet">{embedded}</Panel> : null;
  const reviews = new Map(result.signingReviews.map((s) => [s.requestId, s]));
  return (
    <Panel title="Wallet" count={asked.length}>
      {embedded && <div className="border-b">{embedded}</div>}
      <ul className="divide-y">
        {asked.map((r) => {
          const review = reviews.get(r.id);
          const refused = r.outcome === "rejected" || r.outcome === "errored";
          const outcome = <span className={cx("text-xs", refused ? "text-warn" : "text-muted-foreground")}>{OUTCOME_LABEL[r.outcome]}</span>;
          return (
            <li key={r.id}>
              {review ? (
                <Review review={review} outcome={r.outcome === "approved" ? null : outcome} />
              ) : (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>{METHOD_LABEL[r.method] ?? r.method}</span>
                  {outcome}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** A signature: the verdict at a glance, the evidence folded away. Approved is the norm, so only another outcome shows. */
function Review({ review, outcome }: { review: SigningReview; outcome: React.ReactNode }) {
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

export function IssueList({ result }: { result: TestRunResult }) {
  if (result.issues.length === 0) return null;
  return (
    <Panel title="Problems found" count={result.issues.length}>
      <ul className="divide-y">
        {result.issues.map((i) => (
          <li key={i.id} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-start gap-2">
              <SeverityTag severity={i.severity} />
              <span className="leading-snug font-medium">{i.title}</span>
            </div>
            <p className="leading-snug text-muted-foreground">{i.summary}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ConsoleErrors({ result }: { result: TestRunResult }) {
  const errors = result.console.filter((c) => c.level === "error" || c.level === "pageerror");
  if (errors.length === 0) return null;
  return (
    <Panel title="Console errors" count={errors.length}>
      <pre className="max-h-56 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {errors
          .slice(-30)
          .map((e) => e.text)
          .join("\n")}
      </pre>
    </Panel>
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
