import type { SigningReview, TestRunResult } from "@dappdrill/core";
import { Fragment } from "react";
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

/** What the app asked the wallet for, with the signing review of each signature. */
export function WalletActivity({ result }: { result: TestRunResult }) {
  const asked = result.walletRequests.filter((r) => r.kind !== "other");
  if (asked.length === 0) return null;
  const reviews = new Map(result.signingReviews.map((s) => [s.requestId, s]));
  return (
    <Panel title="Wallet" count={asked.length}>
      <ul className="divide-y">
        {asked.map((r) => {
          const review = reviews.get(r.id);
          return (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span>{review?.title ?? METHOD_LABEL[r.method] ?? r.method}</span>
                <span className={cx("text-xs", r.outcome === "rejected" || r.outcome === "errored" ? "text-warn" : "text-muted-foreground")}>{r.outcome}</span>
              </div>
              {review && <Review review={review} />}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Review({ review }: { review: SigningReview }) {
  const d = review.decoded;
  const flagged = review.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return (
    <details className="group">
      <summary className="flex list-none items-start gap-2">
        <VerdictTag verdict={review.verdict} />
        <span className="leading-snug text-muted-foreground">{review.summary}</span>
      </summary>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        {d.to && (
          <>
            <dt className="text-muted-foreground">Contract</dt>
            <dd>
              <Addr value={d.to} /> {d.contractName && <span className="text-muted-foreground">({d.contractName})</span>}
            </dd>
          </>
        )}
        {d.functionName && (
          <>
            <dt className="text-muted-foreground">Call</dt>
            <dd className="font-mono text-xs break-all">
              {d.functionName}({d.args.map((a) => a.display ?? a.value).join(", ")})
            </dd>
          </>
        )}
        {d.message && (
          <>
            <dt className="text-muted-foreground">Message</dt>
            <dd className="font-mono text-xs break-all whitespace-pre-wrap">{d.message}</dd>
          </>
        )}
        {review.simulation?.balanceChanges.map((b, i) => (
          <Fragment key={i}>
            <dt className="text-muted-foreground">{i === 0 ? "Balance" : ""}</dt>
            <dd>{b.display}</dd>
          </Fragment>
        ))}
        {review.approvals.map((a, i) => (
          <Fragment key={i}>
            <dt className="text-muted-foreground">{i === 0 ? "Grants" : ""}</dt>
            <dd className={cx(a.unlimited && "text-warn")}>{a.display}</dd>
          </Fragment>
        ))}
      </dl>
      {flagged.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {flagged.map((c) => (
            <li key={c.id} className={c.status === "fail" ? "text-bad" : "text-warn"}>
              {c.label}: <span className="text-muted-foreground">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-muted-foreground">{review.explanation}</p>
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
