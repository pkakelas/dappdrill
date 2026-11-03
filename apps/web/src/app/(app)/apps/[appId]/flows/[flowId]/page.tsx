import { chainInfo, edgeCaseInfo } from "@dappdrill/core";
import { db, flowChanges, flows, repairs, runs, scans, variations } from "@dappdrill/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { Copy, Play } from "lucide-react";
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
import { cx, Empty, PageHeader, RUN_STATUS_LABEL, RUN_STATUS_TEXT, Sparkbars } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    <div className="page flex flex-col gap-6">
      {busy && <AutoRefresh every={4000} />}
      <div>
        <Link href={`/apps/${app.id}/flows`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Flows
        </Link>
      </div>
      <PageHeader
        title={flow.name}
        description={
          <>
            {plural(def.steps.length, "step")} · {plural(signatures, "signature")} · {plural(vars.length, "variation")} · {origin}
            {flow.updatedAt.getTime() - flow.createdAt.getTime() > 60_000 && `, edited ${timeAgo(flow.updatedAt)}`}
          </>
        }
        actions={
          <>
            <form action={duplicateFlowAction}>
              <input type="hidden" name="flowId" value={flow.id} />
              <Button type="submit" variant="outline">
                <Copy /> Duplicate
              </Button>
            </form>
            <form action={rerunAction}>
              <input type="hidden" name="appId" value={app.id} />
              <input type="hidden" name="flowId" value={flow.id} />
              <Button type="submit">
                <Play /> Run
              </Button>
            </form>
          </>
        }
      >
        <div className="mt-1 flex items-center gap-3">
          <Sparkbars statuses={statuses.get(flow.id) ?? []} />
          <span>
            {repair ? (
              <span className="text-warn">Needs a fix</span>
            ) : last ? (
              <span className={RUN_STATUS_TEXT[last.status]}>{RUN_STATUS_LABEL[last.status]}</span>
            ) : (
              <span className="text-muted-foreground">Not run yet</span>
            )}
            {last && <span className="text-muted-foreground"> {timeAgo(last.createdAt)}</span>}
          </span>
        </div>
      </PageHeader>

      <Tabs value={tab}>
        <TabsList aria-label="Flow sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} asChild>
              <Link href={t.id === "steps" ? path : `${path}?tab=${t.id}`}>
                {t.label}
                {t.id === "runs" && runRows.length > 0 && <span className="text-muted-foreground">{runRows.length}</span>}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {repair && <RepairBanner repair={repair} flowName={flow.name} current={def} />}

      {tab === "steps" && (
        <div className="flex flex-col gap-10">
          <StepsEditor key={flow.updatedAt.toISOString()} flow={def} />

          <section aria-labelledby="change" className="flex flex-col gap-3">
            <h2 id="change" className="text-lg font-semibold">
              Change this flow
            </h2>
            {changes.map((c) => (
              <ChangeCard key={c.id} change={c} current={def} />
            ))}
            <DescribeForm
              appId={app.id}
              flowId={flow.id}
              label="Describe a change…"
              placeholder="After depositing, check the share price didn't move by more than 0.1%"
              hint="It tries the change on the site with the wallet and shows you the new steps before anything is saved. Prefer files? Use the Code tab."
              button="Propose change"
            />
          </section>

          <section aria-labelledby="variations" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="variations" className="text-lg font-semibold">
                Variations
              </h2>
              <p className="text-muted-foreground">The same steps with other inputs, wallet, chain or account. If the steps themselves differ, duplicate the flow instead.</p>
            </div>
            {vars.length > 0 && (
              <Card className="py-0">
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Variation</TableHead>
                      <TableHead>Changes</TableHead>
                      <TableHead>Last result</TableHead>
                      <TableHead className="sr-only">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vars.map((v) => {
                      const r = lastByVariation.get(v.id);
                      const changesText = [
                        ...Object.entries(v.inputs).map(([k, val]) => `${k} = ${val}`),
                        v.wallet && `wallet = ${WALLET_LABEL[v.wallet]}`,
                        v.chainId && `chain = ${chainInfo(v.chainId)?.name ?? v.chainId}`,
                        v.account && `account = ${v.account}`,
                      ].filter(Boolean);
                      return (
                        <TableRow key={v.id}>
                          <TableCell className="pl-4 font-medium">{v.name}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{changesText.join(" · ") || "—"}</TableCell>
                          <TableCell>
                            {r ? (
                              <Link href={ctx.panelHref(`run.${r.id}`)} className={cx("hover:underline", RUN_STATUS_TEXT[r.status])}>
                                {RUN_STATUS_LABEL[r.status]}
                                {r.result.reason && <span className="text-muted-foreground"> · {r.result.reason}</span>}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">Not run yet</span>
                            )}
                          </TableCell>
                          <TableCell className="pr-4">
                            <div className="flex justify-end gap-1">
                              <form action={rerunAction}>
                                <input type="hidden" name="appId" value={app.id} />
                                <input type="hidden" name="flowId" value={flow.id} />
                                <input type="hidden" name="variationId" value={v.id} />
                                <input type="hidden" name="edgeCase" value="happy" />
                                <Button type="submit" variant="outline" size="xs">
                                  Run
                                </Button>
                              </form>
                              <form action={removeVariationAction}>
                                <input type="hidden" name="variationId" value={v.id} />
                                <Button type="submit" variant="ghost" size="xs" aria-label={`Remove ${v.name}`}>
                                  Remove
                                </Button>
                              </form>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
            <AddVariation flowId={flow.id} params={def.params} />
          </section>

          <section className="flex flex-wrap items-center gap-3 border-t pt-6">
            <form action={archiveFlowAction}>
              <input type="hidden" name="flowId" value={flow.id} />
              <Button type="submit" variant="outline" size="sm" className="text-destructive">
                Archive this flow
              </Button>
            </form>
            <p className="text-muted-foreground">Archived flows stop running. Their past results stay in the reports.</p>
          </section>
        </div>
      )}

      {tab === "runs" &&
        (runRows.length === 0 ? (
          <Empty title="This flow hasn't run yet" />
        ) : (
          <Card className="py-0">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Edge case</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Variation</TableHead>
                  <TableHead className="pr-4">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4">
                      <Link href={ctx.panelHref(`run.${r.id}`)} className="hover:underline">
                        {edgeCaseInfo(r.edgeCase).label}
                      </Link>
                    </TableCell>
                    <TableCell className={RUN_STATUS_TEXT[r.status]}>
                      {RUN_STATUS_LABEL[r.status]}
                      {r.result.reason && <span className="text-muted-foreground"> · {r.result.reason}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{(r.result.variationId && vars.find((v) => v.id === r.result.variationId)?.name) || "—"}</TableCell>
                    <TableCell className="pr-4 text-muted-foreground">
                      {r.batchId ? (
                        <Link href={`/apps/${app.id}/runs/${r.batchId}`} className="hover:underline">
                          {timeAgo(r.createdAt)}
                        </Link>
                      ) : r.scanId ? (
                        <Link href={`/apps/${app.id}/scans/${r.scanId}`} className="hover:underline">
                          {timeAgo(r.createdAt)}
                        </Link>
                      ) : (
                        timeAgo(r.createdAt)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}

      {tab === "code" && (
        <div className="flex flex-col gap-6">
          <CodeEditor key={flow.updatedAt.toISOString()} flowId={flow.id} json={JSON.stringify(def, null, 2)} fileName={`${flow.id}.json`} />
          <Card>
            <CardHeader>
              <CardTitle id="repo">Keep flows in your repo</CardTitle>
              <CardDescription>
                Save this file as <code className="font-mono">.dappdrill/flows/{flow.id}.json</code>. The CLI replays it locally; push edits back with:
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <pre className="overflow-x-auto rounded-md bg-muted px-4 py-3 text-xs">{`DAPPDRILL_TOKEN=… dappdrill push-flows --report-to ${env.appUrl}`}</pre>
              <p className="text-muted-foreground">
                Get a token under{" "}
                <Link href="/account#tokens" className="underline underline-offset-4">
                  Account → API tokens
                </Link>
                . The GitHub Action can also pull these flows on every pull request.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {panelData && <ResultPanel data={panelData} ctx={ctx} />}
    </div>
  );
}
