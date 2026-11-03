import { apiTokens, db, flowChanges, flows } from "@dappdrill/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { CalendarClock, Play } from "lucide-react";
import Link from "next/link";
import { runAllAction } from "@/actions/flows";
import { AutoRefresh } from "@/components/auto-refresh";
import { DescribeForm, ScheduleForm } from "@/components/flows/forms";
import { FlowList, flowTableData } from "@/components/flows/flow-list";
import { ChangeCard, RepairBanner } from "@/components/flows/proposals";
import { Empty, PageHeader } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isHostVerified } from "@/lib/domains";
import { env } from "@/lib/env";
import { plural } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Props = { params: Promise<{ appId: string }>; searchParams: Promise<{ error?: string }> };

export const metadata: Metadata = { title: "Flows" };

export default async function FlowsPage({ params, searchParams }: Props) {
  const { appId } = await params;
  const { error } = await searchParams;
  const { app } = await requireApp(appId);

  const flowRows = await db().select().from(flows).where(and(eq(flows.appId, app.id), eq(flows.archived, false))).orderBy(asc(flows.createdAt));
  const [data, changes, tokens, verified] = await Promise.all([
    flowTableData(flowRows),
    db().select().from(flowChanges).where(and(eq(flowChanges.appId, app.id), isNull(flowChanges.flowId), isNull(flowChanges.resolution))).orderBy(desc(flowChanges.createdAt)),
    db().select({ lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(eq(apiTokens.appId, app.id)),
    isHostVerified(app.teamId, app.host),
  ]);
  const busy = changes.some((c) => c.status === "queued" || c.status === "running");
  const ciUsed = tokens.some((t) => t.lastUsedAt);

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
      {data.openRepairs.map((r) => {
        const f = flowRows.find((x) => x.id === r.flowId);
        return f ? <RepairBanner key={r.id} repair={r} flowName={f.name} current={f.definition} /> : null;
      })}

      {flowRows.length === 0 ? (
        <Empty title="No saved flows yet">A scan saves every flow it finds, or describe one below.</Empty>
      ) : (
        <FlowList appId={app.id} flows={flowRows} data={data} />
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
