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
import { cx, PlayIcon, RUN_STATUS_LABEL, RUN_STATUS_TEXT, Sparkbars } from "@/components/ui";
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

  return (
    <div className="page flex flex-col gap-7">
      {busy && <AutoRefresh every={4000} />}
      <header className="flex flex-col gap-3">
        <span className="crumbs">
          <Link href={`/apps/${app.id}/flows`}>Flows</Link> / {flow.name}
        </span>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="h1">{flow.name}</h1>
            <p className="m-0 text-sm">
              {repair ? (
                <span className="text-warn">Needs a fix</span>
              ) : last ? (
                <span className={RUN_STATUS_TEXT[last.status]}>{RUN_STATUS_LABEL[last.status]}</span>
              ) : (
                <span className="text-muted">Not run yet</span>
              )}
              {last && <span className="text-muted"> {timeAgo(last.createdAt)}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Sparkbars statuses={statuses.get(flow.id) ?? []} />
            <form action={duplicateFlowAction}>
              <input type="hidden" name="flowId" value={flow.id} />
              <button type="submit" className="btn">
                Duplicate
              </button>
            </form>
            <form action={rerunAction}>
              <input type="hidden" name="appId" value={app.id} />
              <input type="hidden" name="flowId" value={flow.id} />
              <button type="submit" className="btn btn-primary">
                <PlayIcon /> Run
              </button>
            </form>
          </div>
        </div>
        <p className="m-0 text-[13px] text-muted">
          {plural(def.steps.length, "step")} · {plural(signatures, "signature")} · {plural(vars.length, "variation")} · {origin}
          {flow.updatedAt.getTime() - flow.createdAt.getTime() > 60_000 && `, edited ${timeAgo(flow.updatedAt)}`}
        </p>
      </header>

      <nav className="seg w-fit" aria-label="Flow sections">
        {TABS.map((t) => (
          <Link key={t.id} href={t.id === "steps" ? path : `${path}?tab=${t.id}`} aria-current={tab === t.id ? "true" : undefined}>
            {t.label}
            {t.id === "runs" && runRows.length > 0 && <span className="text-muted"> {runRows.length}</span>}
          </Link>
        ))}
      </nav>

      {repair && <RepairBanner repair={repair} flowName={flow.name} current={def} />}

      {tab === "steps" && (
        <div className="flex flex-col gap-9">
          <StepsEditor key={flow.updatedAt.toISOString()} flow={def} />

          <section aria-labelledby="change" className="flex flex-col gap-4">
            <h2 id="change" className="h2">
              Change this flow
            </h2>
            {changes.map((c) => (
              <ChangeCard key={c.id} change={c} current={def} />
            ))}
            <div className="card p-5">
              <DescribeForm
                appId={app.id}
                flowId={flow.id}
                label="Describe a change…"
                placeholder="After depositing, check the share price didn't move by more than 0.1%"
                hint="It tries the change on the site with the wallet and shows you the new steps before anything is saved."
                button="Propose change"
              />
            </div>
            <p className="hint m-0">
              Prefer files? Open the <Link href={`${path}?tab=code`}>Code</Link> tab, or keep flows in your repo and sync them with the GitHub Action.
            </p>
          </section>

          <section aria-labelledby="variations" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="variations" className="h2">
                Variations
              </h2>
              <p className="hint m-0">The same steps with other inputs, wallet, chain or account. One result per row.</p>
            </div>
            {vars.length > 0 && (
              <div className="card overflow-x-auto">
                <table className="table min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Variation</th>
                      <th>Changes</th>
                      <th>Last result</th>
                      <th className="sr-only">Actions</th>
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
                          <td className="font-mono text-[13px] text-ink-3">{changesText.join(" · ") || "—"}</td>
                          <td>
                            {r ? (
                              <Link href={ctx.panelHref(`run.${r.id}`)} className={cx("text-sm no-underline hover:underline", RUN_STATUS_TEXT[r.status])}>
                                {RUN_STATUS_LABEL[r.status]}
                                {r.result.reason && <span className="text-muted"> · {r.result.reason}</span>}
                              </Link>
                            ) : (
                              <span className="text-sm text-muted">Not run yet</span>
                            )}
                          </td>
                          <td>
                            <div className="flex justify-end gap-2">
                              <form action={rerunAction}>
                                <input type="hidden" name="appId" value={app.id} />
                                <input type="hidden" name="flowId" value={flow.id} />
                                <input type="hidden" name="variationId" value={v.id} />
                                <input type="hidden" name="edgeCase" value="happy" />
                                <button type="submit" className="btn btn-xs">
                                  Run with…
                                </button>
                              </form>
                              <form action={removeVariationAction}>
                                <input type="hidden" name="variationId" value={v.id} />
                                <button type="submit" className="btn btn-xs" aria-label={`Remove ${v.name}`}>
                                  Remove
                                </button>
                              </form>
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
            <p className="hint m-0">Variations share this flow&apos;s steps. If the steps themselves differ, duplicate the flow instead.</p>
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-6">
            <form action={archiveFlowAction}>
              <input type="hidden" name="flowId" value={flow.id} />
              <button type="submit" className="btn btn-sm text-bad">
                Archive this flow
              </button>
            </form>
            <p className="hint m-0">Archived flows stop running. Their past results stay in the reports.</p>
          </section>
        </div>
      )}

      {tab === "runs" &&
        (runRows.length === 0 ? (
          <p className="m-0 rounded-xl border border-line bg-card px-5 py-4 text-sm text-muted">This flow hasn&apos;t run yet.</p>
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
                {runRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={ctx.panelHref(`run.${r.id}`)} className="no-underline hover:underline">
                        {edgeCaseInfo(r.edgeCase).label}
                      </Link>
                    </td>
                    <td className={cx("text-sm", RUN_STATUS_TEXT[r.status])}>
                      {RUN_STATUS_LABEL[r.status]}
                      {r.result.reason && <span className="text-muted"> · {r.result.reason}</span>}
                    </td>
                    <td className="text-sm text-muted">{(r.result.variationId && vars.find((v) => v.id === r.result.variationId)?.name) || "—"}</td>
                    <td className="text-sm text-muted">
                      {r.batchId ? (
                        <Link href={`/apps/${app.id}/runs/${r.batchId}`}>{timeAgo(r.createdAt)}</Link>
                      ) : r.scanId ? (
                        <Link href={`/apps/${app.id}/scans/${r.scanId}`}>{timeAgo(r.createdAt)}</Link>
                      ) : (
                        timeAgo(r.createdAt)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "code" && (
        <div className="flex flex-col gap-6">
          <CodeEditor key={flow.updatedAt.toISOString()} flowId={flow.id} json={JSON.stringify(def, null, 2)} fileName={`${flow.id}.json`} />
          <section aria-labelledby="repo" className="card flex flex-col gap-3 p-5">
            <h2 id="repo" className="m-0 text-[15px] font-semibold">
              Keep flows in your repo
            </h2>
            <p className="m-0 text-sm text-ink-2">
              Save this file as <code className="font-mono text-[13px]">.dappdrill/flows/{flow.id}.json</code>. The CLI replays it locally; push edits back with:
            </p>
            <pre className="codeblock m-0">{`DAPPDRILL_TOKEN=… dappdrill push-flows --report-to ${env.appUrl}`}</pre>
            <p className="hint m-0">
              Get a token under <Link href="/account#tokens">Account → API tokens</Link>. The GitHub Action can also pull these flows on every pull request.
            </p>
          </section>
        </div>
      )}

      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
