import { chainName, type SigningCheck } from "@dappdrill/core";
import Link from "next/link";
import { acceptBaselineAction, markExpectedAction } from "@/actions/results";
import { ChevronRight, CircleAlert, CircleCheck, CircleHelp, CircleX } from "lucide-react";
import { Addr, cx, VerdictTag } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { artifactOwner, artifactUrl } from "@/lib/artifacts";
import { shortDate } from "@/lib/format";
import { githubNewIssueUrl, reviewMarkdown } from "@/lib/github";
import type { ReviewRow } from "@/lib/report";
import type { ViewCtx } from "./ctx";
import { CopyButton } from "./copy-button";

const CHECK_ORDER: Record<SigningCheck["status"], number> = { fail: 0, warn: 1, unverified: 2, pass: 3, skip: 4 };

function CheckMark({ status }: { status: SigningCheck["status"] }) {
  if (status === "fail") return <CircleX className="size-5 shrink-0 text-bad" aria-label="Failed" />;
  if (status === "warn") return <CircleAlert className="size-5 shrink-0 text-warn-icon" aria-label="Warning" />;
  if (status === "pass") return <CircleCheck className="size-5 shrink-0 text-muted-foreground" aria-label="Passed" />;
  return <CircleHelp className="size-5 shrink-0 text-muted-foreground" aria-label={status === "unverified" ? "Unverified" : "Skipped"} />;
}

function CheckLine({ c }: { c: SigningCheck }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <CheckMark status={c.status} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">
          {c.label}
          {(c.unverified || c.status === "unverified") && (
            <Badge variant="secondary" className="ml-2 align-middle">
              Unverified
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground">{c.detail}</span>
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <VerdictTag verdict={r.verdict} large />
          {row.isBaseline && <Badge variant="outline">Baseline</Badge>}
          <span className="text-muted-foreground">
            {chainName(r.chainId)} · <span className="font-mono">{r.method}</span>
          </span>
        </div>
        <p className="leading-relaxed">{r.summary}</p>
      </div>

      <div className="flex flex-wrap gap-6">
        <div className={cx("flex min-w-0 flex-col gap-6", compact ? "basis-full" : "flex-[3_1_460px]")}>
          <section aria-labelledby={`cmp-${row.id}`} className="flex flex-col gap-3">
            <h3 id={`cmp-${row.id}`} className="font-semibold">
              What the user saw, and what they&apos;d sign
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-4">
                <span className="text-xs text-muted-foreground">On the page</span>
                {shot ? (
                  <a href={shot} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot} alt="The page when the request was made" className="w-full rounded-md border" />
                  </a>
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-md bg-muted text-muted-foreground">No screenshot</div>
                )}
                <span>
                  Button text: <strong className="font-semibold">{r.ui.buttonLabel ? `“${r.ui.buttonLabel}”` : "—"}</strong>
                </span>
                {r.ui.context && <span className="text-muted-foreground">{r.ui.context}</span>}
              </div>
              <div className={cx("flex flex-col gap-2.5 rounded-lg border p-4", r.verdict === "dangerous" ? "border-bad-line bg-bad-soft" : "bg-card")}>
                <span className={cx("text-xs", r.verdict === "dangerous" ? "text-bad-ink" : "text-muted-foreground")}>In the wallet request</span>
                <div className="font-mono text-sm font-medium break-words">{r.decoded.signature ?? r.decoded.functionName ?? r.decoded.primaryType ?? r.method}</div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                  {r.decoded.to && (
                    <>
                      <dt className="text-muted-foreground">Contract</dt>
                      <dd>
                        {r.decoded.contractName ? `${r.decoded.contractName} ` : ""}
                        <Addr value={r.decoded.to} />
                      </dd>
                    </>
                  )}
                  {r.decoded.args.map((a) => (
                    <div key={a.name} className="contents">
                      <dt className="text-muted-foreground">{a.name}</dt>
                      <dd className="break-words">{a.display ?? <span className="font-mono">{a.value}</span>}</dd>
                    </div>
                  ))}
                  {r.decoded.message && (
                    <>
                      <dt className="text-muted-foreground">Message</dt>
                      <dd className="font-mono break-words whitespace-pre-wrap">{r.decoded.message}</dd>
                    </>
                  )}
                  {r.simulation && (
                    <>
                      <dt className="text-muted-foreground">Simulated</dt>
                      <dd>
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
                      <dt className="text-muted-foreground">Grants</dt>
                      <dd className={cx(a.unlimited && "font-semibold text-bad")}>
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
              <h3 id={`checks-${row.id}`} className="font-semibold">
                Checks
              </h3>
              {flagged.length > 0 && <ul className="divide-y rounded-lg border">{flagged.map((c) => <CheckLine key={c.id} c={c} />)}</ul>}
              {passed.length > 0 && (
                <details className="group rounded-lg border">
                  <summary className="flex items-center gap-2 px-4 py-3 text-muted-foreground hover:text-foreground">
                    <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                    {passed.length} checks passed
                  </summary>
                  <ul className="divide-y border-t">{passed.map((c) => <CheckLine key={c.id} c={c} />)}</ul>
                </details>
              )}
            </section>
          )}

          {r.decoded.calldata && (
            <details className="group rounded-lg border">
              <summary className="flex flex-wrap items-center gap-2 px-4 py-3">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                <span className="font-medium">Calldata</span>
                {r.decoded.abiSource && r.decoded.abiSource !== "none" && <span className="text-muted-foreground">· decoded with an ABI from {r.decoded.abiSource}</span>}
              </summary>
              <pre className="border-t bg-muted/50 p-4 text-xs break-all whitespace-pre-wrap">{r.decoded.calldata}</pre>
            </details>
          )}
        </div>

        <aside className={cx("flex min-w-0 flex-col gap-6", compact ? "basis-full" : "flex-[2_1_280px]")}>
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Why</h3>
            <p className="leading-relaxed text-muted-foreground">{r.explanation}</p>
            {r.advice && (
              <>
                <h3 className="mt-2 font-semibold">What to change</h3>
                <p className="leading-relaxed text-muted-foreground">{r.advice}</p>
              </>
            )}
          </section>

          {changes.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">Changed since {r.baseline?.previousAt ? shortDate(r.baseline.previousAt) : "the baseline"}</h3>
              <div className="rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                {changes.map((c, i) => (
                  <div key={i}>
                    <div className="text-bad">
                      − {c.field} {c.before}
                    </div>
                    <div>
                      + {c.field} {c.after}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {siblings.length > 1 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">Requests in this flow</h3>
              <ol className="divide-y rounded-lg border">
                {siblings.map((s, i) => (
                  <li key={s.id}>
                    <Link href={ctx.panelHref(`review.${s.id}`)} scroll={false} className={cx("flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50", s.id === row.id && "bg-muted font-medium")}>
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
                    <Button type="submit" size="sm">
                      Accept as new baseline
                    </Button>
                  </form>
                )}
                {r.verdict !== "consistent" && (
                  <form action={markExpectedAction}>
                    <input type="hidden" name="reviewId" value={row.id} />
                    <Button type="submit" variant="outline" size="sm">
                      This is expected
                    </Button>
                  </form>
                )}
                {ctx.githubRepo ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={githubNewIssueUrl(ctx.githubRepo, r.title, md)} target="_blank" rel="noreferrer">
                      Open GitHub issue
                    </a>
                  </Button>
                ) : (
                  <CopyButton text={md} label="Copy as Markdown" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {row.isBaseline ? "This is the baseline: future runs compare this request against it." : "Accepting makes future runs compare this request against this one."}
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
