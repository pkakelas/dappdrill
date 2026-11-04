import type { SigningReview, TestRunResult } from "@dappdrill/core";
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
      <ul className="m-0 list-none divide-y divide-divide p-0">
        {asked.map((r) => {
          const review = reviews.get(r.id);
          return (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14.5px]">{review?.title ?? METHOD_LABEL[r.method] ?? r.method}</span>
                <span className={cx("font-mono text-[11px]", r.outcome === "rejected" || r.outcome === "errored" ? "text-warn" : "text-muted")}>{r.outcome}</span>
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
        <span className="text-[13px] leading-snug text-ink-3">{review.summary}</span>
      </summary>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        {d.to && (
          <>
            <dt className="text-muted">Contract</dt>
            <dd className="m-0">
              <Addr value={d.to} /> {d.contractName && <span className="text-muted">({d.contractName})</span>}
            </dd>
          </>
        )}
        {d.functionName && (
          <>
            <dt className="text-muted">Call</dt>
            <dd className="m-0 font-mono text-[12px] break-all">
              {d.functionName}({d.args.map((a) => a.display ?? a.value).join(", ")})
            </dd>
          </>
        )}
        {d.message && (
          <>
            <dt className="text-muted">Message</dt>
            <dd className="m-0 font-mono text-[12px] break-all whitespace-pre-wrap">{d.message}</dd>
          </>
        )}
        {review.simulation?.balanceChanges.map((b, i) => (
          <span key={i} className="contents">
            <dt className="text-muted">{i === 0 ? "Balance" : ""}</dt>
            <dd className="m-0">{b.display}</dd>
          </span>
        ))}
        {review.approvals.map((a, i) => (
          <span key={i} className="contents">
            <dt className="text-muted">{i === 0 ? "Grants" : ""}</dt>
            <dd className={cx("m-0", a.unlimited && "text-warn")}>{a.display}</dd>
          </span>
        ))}
      </dl>
      {flagged.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-[13px]">
          {flagged.map((c) => (
            <li key={c.id} className={c.status === "fail" ? "text-bad" : "text-warn"}>
              {c.label}: <span className="text-ink-3">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 mt-2 text-[13px] text-muted">{review.explanation}</p>
    </details>
  );
}

export function IssueList({ result }: { result: TestRunResult }) {
  if (result.issues.length === 0) return null;
  return (
    <Panel title="Problems found" count={result.issues.length}>
      <ul className="m-0 list-none divide-y divide-divide p-0">
        {result.issues.map((i) => (
          <li key={i.id} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-start gap-2">
              <SeverityTag severity={i.severity} />
              <span className="text-[14.5px] leading-snug">{i.title}</span>
            </div>
            <p className="m-0 text-[13px] leading-snug text-ink-3">{i.summary}</p>
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
      <pre className="m-0 max-h-56 overflow-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-3">
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
    <section aria-label={title} className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-divide px-4 py-2.5">
        <h2 className="label m-0">
          {title}
          {count !== undefined && <span className="ml-1.5 text-faint">{count}</span>}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
