import { chainInfo, edgeCaseInfo } from "@dappdrill/core";
import { db, flowChanges, flows, repairs, runs, scans, variations } from "@dappdrill/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveFlowAction, duplicateFlowAction, removeVariationAction } from "@/actions/flows";
import { rerunAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { CodeEditor } from "@/components/flows/code-editor";
import { DescribeForm } from "@/components/flows/forms";
import { ChangeCard, RepairBanner } from "@/components/flows/proposals";
import { StepsEditor } from "@/components/flows/steps-editor";
import { AddVariation } from "@/components/flows/variations";
import { makePanelHref } from "@/components/report/ctx";
import { ResultPanel } from "@/components/report/panels";
import { ActionButton, Disclosure, Empty, PageHeader, PlayIcon, RunState, Section, Sparkbars } from "@/components/ui";
import { env } from "@/lib/env";
import { plural, timeAgo } from "@/lib/format";
import { githubRepo, recentStatuses } from "@/lib/queries";
import { loadPanel } from "@/lib/report";
import { requireApp } from "@/lib/session";

type Props = { params: Promise<{ appId: string; flowId: string }>; searchParams: Promise<{ tab?: string; panel?: string }> };

const TABS = [
  { id: "steps", label: "Steps" },
  { id: "runs", label: "Runs" },
  { id: "code", label: "Code" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const WALLET_LABEL = { metamask: "MetaMask-style", rabby: "Rabby", coinbase: "Coinbase Wallet" } as const;

async function load(appId: string, flowId: string) {
  const { app } = await requireApp(appId);
  const [flow] = await db().select().from(flows).where(and(eq(flows.id, flowId), eq(flows.appId, app.id)));
  if (!flow) notFound();
  return { app, flow };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { appId, flowId } = await params;
  const { flow } = await load(appId, flowId);
  return { title: flow.name };
}

export default async function FlowPage({ params, searchParams }: Props) {
  const { appId, flowId } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "steps";
  const { app, flow } = await load(appId, flowId);
  const def = flow.definition;
  const path = `/apps/${app.id}/flows/${flow.id}`;

  const [runRows, vars, [repair], changes, statuses, [scan], repo, panelData] = await Promise.all([
    db().select().from(runs).where(eq(runs.flowId, flow.id)).orderBy(desc(runs.createdAt)).limit(100),
    db().select().from(variations).where(eq(variations.flowId, flow.id)).orderBy(asc(variations.createdAt)),
    db().select().from(repairs).where(and(eq(repairs.flowId, flow.id), eq(repairs.status, "open"))).orderBy(desc(repairs.createdAt)).limit(1),
    db().select().from(flowChanges).where(and(eq(flowChanges.flowId, flow.id), isNull(flowChanges.resolution))).orderBy(desc(flowChanges.createdAt)),
    recentStatuses([flow.id]),
    flow.scanId ? db().select({ number: scans.number }).from(scans).where(eq(scans.id, flow.scanId)) : Promise.resolve([]),
    githubRepo(app.teamId),
    loadPanel(app.id, sp.panel),
  ]);
  const ctx = { appId: app.id, panelHref: makePanelHref(path, { tab: tab === "steps" ? undefined : tab }), readOnly: false, githubRepo: repo };
  const last = runRows.find((r) => r.edgeCase === "happy") ?? runRows[0];
  const signatures = def.steps.filter((s) => s.kind === "wallet").length;
  const busy = changes.some((c) => c.status === "queued" || c.status === "running");
  const lastByVariation = new Map<string, (typeof runRows)[number]>();
  for (const r of runRows) if (r.result.variationId && !lastByVariation.has(r.result.variationId)) lastByVariation.set(r.result.variationId, r);

  const origin =
    def.origin === "discovered" ? `found by scan #${scan?.number ?? "?"}` : def.origin === "described" ? "added in plain English" : def.origin === "recorded" ? "recorded" : "from your repo";

  const runLink = (r: (typeof runRows)[number]) => (r.batchId ? `/apps/${app.id}/runs/${r.batchId}` : r.scanId ? `/apps/${app.id}/scans/${r.scanId}` : null);

  return (
    <div className="page gap-8">
      {busy && <AutoRefresh every={4000} />}
      <PageHeader
        crumbs={[{ label: "Flows", href: `/apps/${app.id}/flows` }, { label: flow.name }]}
        title={flow.name}
        status={
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2 text-body">
            <span>
              <RunState status={last?.status} needsFix={Boolean(repair)} />
              {last && <span className="text-muted"> {timeAgo(last.createdAt)}</span>}
            </span>
            <Sparkbars statuses={statuses.get(flow.id) ?? []} />
          </p>
        }
        sub={
          <span className="meta">
            {plural(def.steps.length, "step")} · {plural(signatures, "signature")} · {plural(vars.length, "variation")} · {origin}
            {flow.updatedAt.getTime() - flow.createdAt.getTime() > 60_000 && `, edited ${timeAgo(flow.updatedAt)}`}
          </span>
        }
        actions={
          <>
            <ActionButton action={duplicateFlowAction} fields={{ flowId: flow.id }} pendingText="Duplicating…">
              Duplicate
            </ActionButton>
            <ActionButton action={rerunAction} fields={{ appId: app.id, flowId: flow.id }} className="btn-primary" pendingText="Queuing…">
              <PlayIcon /> Run
            </ActionButton>
          </>
        }
      />

      <nav className="seg" aria-label="Flow sections">
        {TABS.map((t) => (
          <Link key={t.id} href={t.id === "steps" ? path : `${path}?tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined} scroll={false}>
            {t.label}
            {t.id === "runs" && runRows.length > 0 && <span className="count">{runRows.length}</span>}
          </Link>
        ))}
      </nav>

      {repair && <RepairBanner repair={repair} flowName={flow.name} current={def} />}

      {tab === "steps" && (
        <div className="flex flex-col gap-10">
          <StepsEditor key={flow.updatedAt.toISOString()} flow={def} />

          <Section title="Change this flow" hint="Describe the change. The agent tries it on the site with the wallet and shows you the new steps before anything is saved.">
            {changes.map((c) => (
              <ChangeCard key={c.id} change={c} current={def} />
            ))}
            <div className="card p-5">
              <DescribeForm
                appId={app.id}
                flowId={flow.id}
                label="Describe a change"
                placeholder="After depositing, check the share price didn't move by more than 0.1%"
                hint={
                  <>
                    Prefer files? Use the{" "}
                    <Link href={`${path}?tab=code`} className="prose-link">
                      Code
                    </Link>{" "}
                    tab, or keep flows in your repo.
                  </>
                }
                button="Propose change"
              />
            </div>
          </Section>

          <Section title="Variations" hint="The same steps with other inputs, wallet, chain or account. If the steps themselves differ, duplicate the flow instead.">
            {vars.length > 0 && (
              <div className="card overflow-x-auto">
                <table className="table min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Variation</th>
                      <th>Changes</th>
                      <th>Last result</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vars.map((v) => {
                      const r = lastByVariation.get(v.id);
                      const changesText = [
                        ...Object.entries(v.inputs).map(([k, val]) => `${k} = ${val}`),
                        v.wallet && `wallet = ${WALLET_LABEL[v.wallet]}`,
                        v.chainId && `chain = ${chainInfo(v.chainId)?.name ?? v.chainId}`,
                        v.account && `account = ${v.account}`,
                      ].filter(Boolean);
                      return (
                        <tr key={v.id}>
                          <td className="font-medium">{v.name}</td>
                          <td className="font-mono text-meta text-ink-3">{changesText.join(" · ") || "—"}</td>
                          <td className="text-sm">
                            {r ? (
                              <Link href={ctx.panelHref(`run.${r.id}`)} scroll={false} className="no-underline hover:underline">
                                <RunState status={r.status} />
                                {r.result.reason && <span className="text-muted"> · {r.result.reason}</span>}
                              </Link>
                            ) : (
                              <RunState />
                            )}
                          </td>
                          <td>
                            <div className="flex justify-end gap-2">
                              <ActionButton action={rerunAction} fields={{ appId: app.id, flowId: flow.id, variationId: v.id, edgeCase: "happy" }} className="btn-xs" pendingText="Queuing…">
                                Run with…
                              </ActionButton>
                              <ActionButton action={removeVariationAction} fields={{ variationId: v.id }} className="btn-xs" confirm="Remove?" aria-label={`Remove ${v.name}`}>
                                Remove
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <AddVariation flowId={flow.id} params={def.params} />
          </Section>

          <section aria-label="Archive" className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
            <p className="hint m-0">Archived flows stop running. Their past results stay in the reports.</p>
            <ActionButton action={archiveFlowAction} fields={{ flowId: flow.id }} className="btn-sm" confirm="Archive it?">
              Archive this flow
            </ActionButton>
          </section>
        </div>
      )}

      {tab === "runs" &&
        (runRows.length === 0 ? (
          <Empty
            title="Not run yet"
            action={
              <ActionButton action={rerunAction} fields={{ appId: app.id, flowId: flow.id }} className="btn-primary" pendingText="Queuing…">
                <PlayIcon /> Run it now
              </ActionButton>
            }
          >
            Each run replays the saved steps against a fresh fork, once per edge case.
          </Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Edge case</th>
                  <th>Result</th>
                  <th>Variation</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {runRows.map((r) => {
                  const href = runLink(r);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={ctx.panelHref(`run.${r.id}`)} scroll={false} className="stretched no-underline">
                          {edgeCaseInfo(r.edgeCase).label}
                        </Link>
                      </td>
                      <td className="text-sm">
                        <RunState status={r.status} />
                        {r.result.reason && <span className="text-muted"> · {r.result.reason}</span>}
                      </td>
                      <td className="text-sm text-muted">{(r.result.variationId && vars.find((v) => v.id === r.result.variationId)?.name) || "—"}</td>
                      <td className="text-sm text-muted">
                        {href ? (
                          <Link href={href} className="prose-link">
                            {timeAgo(r.createdAt)}
                          </Link>
                        ) : (
                          timeAgo(r.createdAt)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "code" && (
        <div className="flex flex-col gap-6">
          <CodeEditor key={flow.updatedAt.toISOString()} flowId={flow.id} json={JSON.stringify(def, null, 2)} fileName={`${flow.id}.json`} />
          <Disclosure summary="Keep flows in your repo">
            <div className="flex flex-col gap-3 p-5">
              <p className="m-0 text-sm text-ink-2">
                Save this file as <code className="font-mono text-meta">.dappdrill/flows/{flow.id}.json</code>. The CLI replays it locally; push edits back with:
              </p>
              <pre className="codeblock m-0">{`DAPPDRILL_TOKEN=… dappdrill push-flows --report-to ${env.appUrl}`}</pre>
              <p className="hint m-0">
                Get a token under{" "}
                <Link href="/account#tokens-section" className="prose-link">
                  Account → API tokens
                </Link>
                . The GitHub Action can also pull these flows on every pull request.
              </p>
            </div>
          </Disclosure>
        </div>
      )}

      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
