import { apiTokens, db, flowChanges, flows, repairs, scans, variations } from "@dappdrill/db";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { CalendarClock, Play } from "lucide-react";
import Link from "next/link";
import { runAllAction } from "@/actions/flows";
import { rerunAction } from "@/actions/results";
import { AutoRefresh } from "@/components/auto-refresh";
import { DescribeForm, ScheduleForm } from "@/components/flows/forms";
import { ChangeCard, RepairBanner } from "@/components/flows/proposals";
import { cx, Empty, PageHeader, RUN_STATUS_LABEL, RUN_STATUS_TEXT, Sparkbars } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isHostVerified } from "@/lib/domains";
import { env } from "@/lib/env";
import { plural, timeAgo } from "@/lib/format";
import { lastRuns, recentStatuses, type FlowRow } from "@/lib/queries";
import { requireApp } from "@/lib/session";

type Props = { params: Promise<{ appId: string }>; searchParams: Promise<{ error?: string }> };

export const metadata: Metadata = { title: "Flows" };

export default async function FlowsPage({ params, searchParams }: Props) {
  const { appId } = await params;
  const { error } = await searchParams;
  const { app } = await requireApp(appId);

  const flowRows = await db().select().from(flows).where(and(eq(flows.appId, app.id), eq(flows.archived, false))).orderBy(asc(flows.createdAt));
  const ids = flowRows.map((f) => f.id);
  const scanIds = [...new Set(flowRows.map((f) => f.scanId).filter((x): x is string => Boolean(x)))];
  const [statuses, last, openRepairs, changes, scanRows, varCounts, tokens, verified] = await Promise.all([
    recentStatuses(ids),
    lastRuns(ids),
    ids.length ? db().select().from(repairs).where(and(inArray(repairs.flowId, ids), eq(repairs.status, "open"))).orderBy(desc(repairs.createdAt)) : [],
    db().select().from(flowChanges).where(and(eq(flowChanges.appId, app.id), isNull(flowChanges.flowId), isNull(flowChanges.resolution))).orderBy(desc(flowChanges.createdAt)),
    scanIds.length ? db().select({ id: scans.id, number: scans.number }).from(scans).where(inArray(scans.id, scanIds)) : [],
    ids.length ? db().select({ flowId: variations.flowId, n: count() }).from(variations).where(inArray(variations.flowId, ids)).groupBy(variations.flowId) : [],
    db().select({ lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(eq(apiTokens.appId, app.id)),
    isHostVerified(app.teamId, app.host),
  ]);
  const scanNo = new Map(scanRows.map((s) => [s.id, s.number]));
  const varN = new Map(varCounts.map((v) => [v.flowId, v.n]));
  const repairFor = new Map(openRepairs.map((r) => [r.flowId, r]));
  const busy = changes.some((c) => c.status === "queued" || c.status === "running");
  const ciUsed = tokens.some((t) => t.lastUsedAt);

  function origin(f: FlowRow): string {
    const n = varN.get(f.id);
    const base =
      f.definition.origin === "discovered" && f.scanId && scanNo.has(f.scanId)
        ? `Found by scan #${scanNo.get(f.scanId)}`
        : f.definition.origin === "described"
          ? "Added by you, in plain English"
          : f.definition.origin === "recorded"
            ? "Recorded by you"
            : f.definition.origin === "code"
              ? "From your repo"
              : "Found by a scan";
    return n ? `${base} · ${plural(n, "variation")}` : base;
  }

  return (
    <div className="page flex flex-col gap-6">
      {busy && <AutoRefresh every={4000} />}
      <PageHeader
        title="Flows"
        description={`${plural(flowRows.length, "saved flow")}. Replays don't use your scan allowance, so run them as often as you like.`}
        actions={
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <CalendarClock /> Schedule
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <ScheduleForm appId={app.id} time={app.scheduleTime} verified={verified} host={app.host} />
              </PopoverContent>
            </Popover>
            <form action={runAllAction}>
              <input type="hidden" name="appId" value={app.id} />
              <Button type="submit" disabled={flowRows.length === 0}>
                <Play /> Run all
              </Button>
            </form>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {app.scheduleTime ? `Runs every day at ${app.scheduleTime} UTC` : "No daily schedule"} ·{" "}
          {ciUsed ? (
            "On every pull request, via GitHub Action"
          ) : (
            <Link href="/account#tokens" className="underline underline-offset-4">
              Set up the GitHub Action
            </Link>
          )}
        </p>
      </PageHeader>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {changes.map((c) => (
        <ChangeCard key={c.id} change={c} />
      ))}
      {openRepairs.map((r) => {
        const f = flowRows.find((x) => x.id === r.flowId);
        return f ? <RepairBanner key={r.id} repair={r} flowName={f.name} current={f.definition} /> : null;
      })}

      {flowRows.length === 0 ? (
        <Empty title="No saved flows yet">A scan saves every flow it finds, or describe one below.</Empty>
      ) : (
        <Card className="py-0">
          <Table className="md:min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Flow</TableHead>
                <TableHead className="hidden text-right md:table-cell">Steps</TableHead>
                <TableHead className="hidden text-right md:table-cell">Signatures</TableHead>
                <TableHead className="hidden sm:table-cell">Last run</TableHead>
                <TableHead className="hidden sm:table-cell">Last 10 runs</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flowRows.map((f) => {
                const l = last.get(f.id);
                const needsFix = repairFor.has(f.id);
                return (
                  <TableRow key={f.id}>
                    <TableCell className="pl-4 whitespace-normal">
                      <Link href={`/apps/${app.id}/flows/${f.id}`} className="font-medium hover:underline">
                        {f.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{origin(f)}</div>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{f.definition.steps.length}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{f.definition.steps.filter((s) => s.kind === "wallet").length}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className={cx(needsFix ? "text-warn" : l ? RUN_STATUS_TEXT[l.status] : "text-muted-foreground")}>
                        {needsFix ? "Needs a fix" : l ? RUN_STATUS_LABEL[l.status] : "Not run yet"}
                      </span>
                      {l && <span className="text-muted-foreground"> · {timeAgo(l.at)}</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Sparkbars statuses={statuses.get(f.id) ?? []} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <form action={rerunAction}>
                        <input type="hidden" name="appId" value={app.id} />
                        <input type="hidden" name="flowId" value={f.id} />
                        <Button type="submit" variant="outline" size="sm" aria-label={`Run ${f.name}`}>
                          <Play /> Run
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <DescribeForm
            appId={app.id}
            label="Add a flow"
            placeholder="e.g. Deposit 50 USDC, then withdraw half of it"
            hint="It walks the flow once with the wallet, shows you the steps, and saves them after you confirm."
            button="Add flow"
          />
          <p className="text-sm text-muted-foreground">
            Keeping flows in your repo? <code className="font-mono">dappdrill push-flows --report-to {env.appUrl}</code> uploads them; see{" "}
            <Link href="/account#tokens" className="underline underline-offset-4">
              API tokens
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
