import { chainName, type SigningCheck } from "@dappdrill/core";
import Link from "next/link";
import { acceptBaselineAction, markExpectedAction } from "@/actions/results";
import { Addr, CheckIcon, cx, VerdictTag } from "@/components/ui";
import { artifactOwner, artifactUrl } from "@/lib/artifacts";
import { shortDate } from "@/lib/format";
import { githubNewIssueUrl, reviewMarkdown } from "@/lib/github";
import type { ReviewRow } from "@/lib/report";
import type { ViewCtx } from "./ctx";
import { CopyButton } from "./copy-button";

const CHECK_ORDER: Record<SigningCheck["status"], number> = { fail: 0, warn: 1, unverified: 2, pass: 3, skip: 4 };

function CheckMark({ status }: { status: SigningCheck["status"] }) {
  if (status === "fail")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-bad text-white" aria-label="Failed">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
        </svg>
      </span>
    );
  if (status === "warn")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warn-bg text-[12px] font-bold text-warn-icon" aria-label="Warning">
        !
      </span>
    );
  if (status === "pass")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-hair text-muted" aria-label="Passed">
        <CheckIcon />
      </span>
    );
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-quiet text-[11px] text-muted" aria-label={status === "unverified" ? "Unverified" : "Skipped"}>
      ?
    </span>
  );
}

function CheckLine({ c }: { c: SigningCheck }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <CheckMark status={c.status} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {c.label}
          {(c.unverified || c.status === "unverified") && <span className="pill ml-2 bg-hair align-middle text-muted">Unverified</span>}
        </span>
        <span className="text-[13px] leading-normal text-muted">{c.detail}</span>
      </div>
    </li>
  );
}

export function SigningReviewView({ row, ctx, siblings = [], compact }: { row: ReviewRow; ctx: ViewCtx; siblings?: ReviewRow[]; compact?: boolean }) {
  const r = row.data;
  const owner = artifactOwner(row);
  const shot = artifactUrl(owner, r.ui.screenshot, ctx.share);
  const checks = [...r.checks].sort((a, b) => CHECK_ORDER[a.status] - CHECK_ORDER[b.status]);
  const flagged = checks.filter((c) => c.status === "fail" || c.status === "warn" || c.status === "unverified");
  const passed = checks.filter((c) => c.status === "pass" || c.status === "skip");
  const changes = r.baseline?.changes ?? [];
  const md = reviewMarkdown(r);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <VerdictTag verdict={r.verdict} large />
          {row.isBaseline && <span className="pill bg-hair text-muted">Baseline</span>}
          <span className="text-[13px] text-muted">
            {chainName(r.chainId)} · <span className="font-mono">{r.method}</span>
          </span>
        </div>
        <p className="m-0 text-[15px] leading-relaxed text-ink-2">{r.summary}</p>
      </div>

      <div className="flex flex-wrap gap-7">
        <div className={cx("flex min-w-0 flex-col gap-7", compact ? "basis-full" : "flex-[3_1_460px]")}>
          <section aria-labelledby={`cmp-${row.id}`} className="flex flex-col gap-3">
            <h3 id={`cmp-${row.id}`} className="m-0 text-[15px] font-semibold">
              What the user saw, and what they&apos;d sign
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-white p-4">
                <span className="text-xs text-muted">On the page</span>
                {shot ? (
                  <a href={shot} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot} alt="The page when the request was made" className="w-full rounded-lg border border-divide" />
                  </a>
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-lg bg-sub text-[13px] text-faint">No screenshot</div>
                )}
                <span className="text-[13px]">
                  Button text: <strong className="font-semibold">{r.ui.buttonLabel ? `“${r.ui.buttonLabel}”` : "—"}</strong>
                </span>
                {r.ui.context && <span className="text-[13px] text-muted">{r.ui.context}</span>}
              </div>
              <div className={cx("flex flex-col gap-2.5 rounded-xl border p-4", r.verdict === "dangerous" ? "border-bad-line bg-bad-soft" : "border-line bg-white")}>
                <span className={cx("text-xs", r.verdict === "dangerous" ? "text-bad-ink" : "text-muted")}>In the wallet request</span>
                <div className="font-mono text-sm font-medium break-words">{r.decoded.signature ?? r.decoded.functionName ?? r.decoded.primaryType ?? r.method}</div>
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                  {r.decoded.to && (
                    <>
                      <dt className="text-muted">Contract</dt>
                      <dd className="m-0">
                        {r.decoded.contractName ? `${r.decoded.contractName} ` : ""}
                        <Addr value={r.decoded.to} />
                      </dd>
                    </>
                  )}
                  {r.decoded.args.map((a) => (
                    <div key={a.name} className="contents">
                      <dt className="text-muted">{a.name}</dt>
                      <dd className="m-0 break-words">{a.display ?? <span className="font-mono">{a.value}</span>}</dd>
                    </div>
                  ))}
                  {r.decoded.message && (
                    <>
                      <dt className="text-muted">Message</dt>
                      <dd className="m-0 font-mono break-words whitespace-pre-wrap">{r.decoded.message}</dd>
                    </>
                  )}
                  {r.simulation && (
                    <>
                      <dt className="text-muted">Simulated</dt>
                      <dd className="m-0">
                        {r.simulation.status === "reverted"
                          ? `Reverts${r.simulation.revertReason ? `: ${r.simulation.revertReason}` : ""}`
                          : r.simulation.status === "unavailable"
                            ? "Simulation unavailable"
                            : r.simulation.balanceChanges.length === 0
                              ? "No balance change."
                              : r.simulation.balanceChanges.map((b, i) => (
                                  <span key={i} className={cx("block", b.delta.startsWith("-") && "text-bad")}>
                                    {b.display}
                                  </span>
                                ))}
                      </dd>
                    </>
                  )}
                  {r.approvals.map((a, i) => (
                    <div key={i} className="contents">
                      <dt className="text-muted">Grants</dt>
                      <dd className={cx("m-0", a.unlimited && "font-semibold text-bad")}>
                        {a.display} to {a.spenderName ? `${a.spenderName} ` : ""}
                        <Addr value={a.spender} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </section>

          {checks.length > 0 && (
            <section aria-labelledby={`checks-${row.id}`} className="flex flex-col gap-3">
              <h3 id={`checks-${row.id}`} className="m-0 text-[15px] font-semibold">
                Checks
              </h3>
              {flagged.length > 0 && <ul className="card m-0 list-none divide-y divide-divide p-0">{flagged.map((c) => <CheckLine key={c.id} c={c} />)}</ul>}
              {passed.length > 0 && (
                <details className="card">
                  <summary className="px-4 py-3 text-sm text-muted">{passed.length} checks passed</summary>
                  <ul className="m-0 list-none divide-y divide-divide border-t border-divide p-0">{passed.map((c) => <CheckLine key={c.id} c={c} />)}</ul>
                </details>
              )}
            </section>
          )}

          {r.decoded.calldata && (
            <details className="card">
              <summary className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <span className="text-sm font-semibold">Calldata</span>
                {r.decoded.abiSource && r.decoded.abiSource !== "none" && <span className="text-[13px] text-muted">Decoded with an ABI from {r.decoded.abiSource}</span>}
              </summary>
              <pre className="codeblock m-0 rounded-t-none text-xs break-all whitespace-pre-wrap">{r.decoded.calldata}</pre>
            </details>
          )}
        </div>

        <aside className={cx("flex min-w-0 flex-col gap-6", compact ? "basis-full" : "flex-[2_1_280px]")}>
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-[15px] font-semibold">Why</h3>
            <p className="m-0 text-sm leading-relaxed text-ink-2">{r.explanation}</p>
            {r.advice && (
              <>
                <h3 className="m-0 mt-2 text-[15px] font-semibold">What to change</h3>
                <p className="m-0 text-sm leading-relaxed text-ink-2">{r.advice}</p>
              </>
            )}
          </section>

          {changes.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-[15px] font-semibold">Changed since {r.baseline?.previousAt ? shortDate(r.baseline.previousAt) : "the baseline"}</h3>
              <div className="codeblock text-xs leading-[1.9]">
                {changes.map((c, i) => (
                  <div key={i}>
                    <div className="text-[#f2a58e]">
                      − {c.field} {c.before}
                    </div>
                    <div className="text-[#b9e3c6]">
                      + {c.field} {c.after}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {siblings.length > 1 && (
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-[15px] font-semibold">Requests in this flow</h3>
              <ol className="card m-0 list-none divide-y divide-divide p-0">
                {siblings.map((s, i) => (
                  <li key={s.id}>
                    <Link href={ctx.panelHref(`review.${s.id}`)} scroll={false} className={cx("flex items-center justify-between gap-3 px-4 py-3 text-[13px] no-underline hover:bg-sub", s.id === row.id && "bg-sub font-medium")}>
                      <span className="min-w-0 truncate">
                        {i + 1} · {s.data.title}
                      </span>
                      <VerdictTag verdict={s.verdict} />
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {!ctx.readOnly && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {!row.isBaseline && (
                  <form action={acceptBaselineAction}>
                    <input type="hidden" name="reviewId" value={row.id} />
                    <button type="submit" className="btn btn-sm btn-primary">
                      Accept as new baseline
                    </button>
                  </form>
                )}
                {r.verdict !== "consistent" && (
                  <form action={markExpectedAction}>
                    <input type="hidden" name="reviewId" value={row.id} />
                    <button type="submit" className="btn btn-sm">
                      This is expected
                    </button>
                  </form>
                )}
                {ctx.githubRepo ? (
                  <a href={githubNewIssueUrl(ctx.githubRepo, r.title, md)} target="_blank" rel="noreferrer" className="btn btn-sm">
                    Open GitHub issue
                  </a>
                ) : (
                  <CopyButton text={md} label="Copy as Markdown" />
                )}
              </div>
              <p className="hint m-0">
                {row.isBaseline ? "This is the baseline: future runs compare this request against it." : "Accepting makes future runs compare this request against this one."}
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
