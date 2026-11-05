import type { SigningReview, TestRunResult, WalletRequest } from "@dappdrill/core";
import { ArrowLeftRight, KeyRound, PenLine, Plug, Plus, Send, Users, Wallet, type LucideIcon } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Addr, cx, SeverityTag, VerdictTag } from "@/components/ui";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const METHODS: Record<string, { label: string; icon: LucideIcon }> = {
  eth_requestAccounts: { label: "Connect", icon: Plug },
  wallet_requestPermissions: { label: "Request permissions", icon: KeyRound },
  eth_accounts: { label: "Read accounts", icon: Users },
  wallet_switchEthereumChain: { label: "Switch network", icon: ArrowLeftRight },
  wallet_addEthereumChain: { label: "Add network", icon: Plus },
  eth_sendTransaction: { label: "Send transaction", icon: Send },
  personal_sign: { label: "Sign message", icon: PenLine },
  eth_signTypedData_v4: { label: "Sign typed data", icon: PenLine },
  wallet_sendCalls: { label: "Send calls", icon: Send },
};

const OUTCOME_LABEL: Record<WalletRequest["outcome"], string> = { approved: "Approved", rejected: "Rejected", errored: "Errored", pending: "Pending" };

type Tab = { value: string; label: string; count: number; flag?: "bad" | "warn"; body: React.ReactNode };

/** What a run left behind, one tab each, so the page doesn't grow with it. Problems come first when there are any. */
export function RunDetails({ result, history }: { result?: TestRunResult; history?: { count: number; list: React.ReactNode } }) {
  const asked = result?.walletRequests.filter((r) => r.kind !== "other") ?? [];
  const errors = result?.console.filter((c) => c.level === "error" || c.level === "pageerror") ?? [];
  const verdicts = result?.signingReviews.map((r) => r.verdict) ?? [];
  const tabs: Tab[] = [];
  if (result?.issues.length) tabs.push({ value: "problems", label: "Problems", count: result.issues.length, flag: "bad", body: <IssueList result={result} /> });
  if (result && asked.length > 0)
    tabs.push({
      value: "wallet",
      label: "Wallet",
      count: asked.length,
      flag: verdicts.includes("dangerous") ? "bad" : verdicts.includes("check") ? "warn" : undefined,
      body: <WalletActivity asked={asked} reviews={result.signingReviews} />,
    });
  if (errors.length > 0) tabs.push({ value: "console", label: "Console", count: errors.length, body: <ConsoleErrors errors={errors.slice(-30).map((e) => e.text)} /> });
  if (history) tabs.push({ value: "results", label: "Results", count: history.count, body: history.list });
  if (tabs.length === 0) return null;
  return (
    // Keyed so moving to a result without the open tab doesn't leave an empty panel.
    <Tabs key={tabs.map((t) => t.value).join()} defaultValue={tabs[0]!.value} className="gap-1">
      <TabsList variant="line" className="w-full justify-start gap-5 rounded-none border-b p-0">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="flex-none rounded-none px-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-2px]">
            {t.label}
            <span className="font-normal text-muted-foreground tabular-nums">{t.count}</span>
            {t.flag && <span className={cx("size-1.5 rounded-full", t.flag === "bad" ? "bg-bad" : "bg-warn-bar")} />}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function RequestIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** A dApp often asks twice in a row; one line says so just as well. Signatures always keep their own line. */
function collapseRepeats(asked: WalletRequest[], reviewed: Set<string>) {
  const rows: { request: WalletRequest; times: number }[] = [];
  for (const r of asked) {
    const last = rows.at(-1);
    if (last && !reviewed.has(r.id) && !reviewed.has(last.request.id) && last.request.method === r.method && last.request.outcome === r.outcome) last.times++;
    else rows.push({ request: r, times: 1 });
  }
  return rows;
}

/** What the app asked the wallet for, with the signing review of each signature. */
function WalletActivity({ asked, reviews }: { asked: WalletRequest[]; reviews: SigningReview[] }) {
  const byRequest = new Map(reviews.map((s) => [s.requestId, s]));
  return (
    <Accordion type="multiple" asChild>
      <ul className="divide-y divide-border/60">
        {collapseRepeats(asked, new Set(byRequest.keys())).map(({ request: r, times }) => {
          const review = byRequest.get(r.id);
          const method = METHODS[r.method];
          const refused = r.outcome === "rejected" || r.outcome === "errored";
          const outcome = <span className={cx("text-xs", refused ? "text-warn" : "text-muted-foreground")}>{OUTCOME_LABEL[r.outcome]}</span>;
          if (review) return <Review key={r.id} review={review} icon={method?.icon ?? PenLine} outcome={r.outcome === "approved" ? null : outcome} />;
          return (
            <li key={r.id} className="flex items-start gap-3 py-3">
              <RequestIcon icon={method?.icon ?? Wallet} />
              <span className="min-w-0 flex-1 truncate">
                {method?.label ?? r.method}
                {times > 1 && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">×{times}</span>}
              </span>
              {outcome}
            </li>
          );
        })}
      </ul>
    </Accordion>
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
function Review({ review, icon, outcome }: { review: SigningReview; icon: LucideIcon; outcome: React.ReactNode }) {
  const d = review.decoded;
  const flagged = review.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return (
    <AccordionItem value={review.requestId} asChild className="border-b-0">
      <li>
        <AccordionTrigger className="items-start gap-3 py-3 font-normal hover:no-underline">
          <span className="flex min-w-0 flex-1 items-start gap-3">
            <RequestIcon icon={icon} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="leading-snug font-medium">{review.title}</span>
              <span className="leading-snug text-muted-foreground">{review.summary}</span>
            </span>
            <span className="flex items-center gap-2">
              {outcome}
              <VerdictTag verdict={review.verdict} />
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-4 pl-7">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2">
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
                <span className="block max-h-40 overflow-auto font-mono text-xs break-words whitespace-pre-wrap">{d.message}</span>
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
        </AccordionContent>
      </li>
    </AccordionItem>
  );
}

function IssueList({ result }: { result: TestRunResult }) {
  return (
    <ul className="divide-y divide-border/60">
      {result.issues.map((i) => (
        <li key={i.id} className="flex flex-col gap-1.5 py-3">
          <div className="flex items-start gap-2">
            <SeverityTag severity={i.severity} />
            <span className="leading-snug font-medium">{i.title}</span>
          </div>
          <p className="leading-snug text-muted-foreground">{i.summary}</p>
        </li>
      ))}
    </ul>
  );
}

function ConsoleErrors({ errors }: { errors: string[] }) {
  return (
    <>
      <ul className="max-h-80 divide-y divide-border/60 overflow-auto">
        {errors.map((text, i) => (
          <li key={i} className="py-3">
            <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{text}</pre>
          </li>
        ))}
      </ul>
      <CopyButton text={errors.join("\n")} label="Copy" size="xs" className="mt-1" />
    </>
  );
}
