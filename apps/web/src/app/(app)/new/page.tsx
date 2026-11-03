import { DEFAULT_EDGE_CASES } from "@dappdrill/core";
import type { Metadata } from "next";
import Link from "next/link";
import { NewScanForm, type NewScanDefaults } from "@/components/scan/new-scan-form";
import { cx, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { plural, hostFromUrl, timeAgo } from "@/lib/format";
import { PLANS, scanAllowance } from "@/lib/plan";
import { flowCountsByScan, healthOfCounts, issueCounts, recentScans } from "@/lib/queries";
import { currentTeam, requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "New scan" };

const STATUS_TEXT = { queued: "Queued", running: "Running", failed: "Failed", stopped: "Stopped" } as const;

export default async function NewScanPage({ searchParams }: { searchParams: Promise<{ app?: string; add?: string }> }) {
  const { app: appId, add } = await searchParams;
  const { team } = await currentTeam();
  const app = appId && !add ? (await requireApp(appId)).app : undefined;

  const defaults: NewScanDefaults = app
    ? {
        appId: app.id,
        url: app.url,
        chains: app.settings.chains,
        wallets: app.settings.wallets,
        edgeCases: app.settings.edgeCases,
        hints: app.settings.hints ?? "",
        allowMainnetLive: Boolean(app.settings.allowMainnetLive),
        liveKeyAddress: app.liveKeyAddress,
        accessHeaderNames: app.accessHeaderNames,
      }
    : { url: "", chains: [], wallets: ["metamask", "rabby"], edgeCases: DEFAULT_EDGE_CASES, hints: "", allowMainnetLive: false, liveKeyAddress: null, accessHeaderNames: [] };

  let usage: string | null = null;
  if (app) {
    const a = await scanAllowance(app.id, team.plan);
    usage = a.unlimited
      ? `Dev mode: scans aren't counted (${a.used} this month)`
      : a.left > 0
        ? `Uses 1 of your ${a.left} remaining scans for ${app.name}`
        : `No discovery scans left this month (${PLANS[team.plan].name} plan)`;
  } else {
    usage = `${PLANS[team.plan].name}: ${plural(PLANS[team.plan].scansPerMonth, "discovery scan")} per app each month`;
  }

  const recent = await recentScans(team.id);
  const ids = recent.map((r) => r.scan.id);
  const [counts, flowCounts] = await Promise.all([issueCounts("scan", ids), flowCountsByScan(ids)]);

  return (
    <div className="page flex flex-col gap-8">
      <PageHeader
        title="New scan"
        description="DappDrill opens your dApp with its own wallet on a fork of each chain, walks every flow it can find, and makes the wallet mistakes real users make. Nothing touches mainnet."
      />

      <NewScanForm key={app?.id ?? "new"} defaults={defaults} usage={usage} />

      {recent.length > 0 && (
        <section aria-labelledby="recent" className="flex flex-col gap-3">
          <h2 id="recent" className="text-lg font-semibold">
            Recent scans
          </h2>
          <div className="rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">App</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="hidden sm:table-cell">Flows</TableHead>
                  <TableHead className="pr-4 text-right">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map(({ scan, appUrl }) => {
                  const c = counts.get(scan.id);
                  const health = healthOfCounts(c);
                  const attention = c ? c.critical + c.high : 0;
                  const toCheck = c ? c.medium + c.low : 0;
                  const href = `/apps/${scan.appId}/scans/${scan.id}`;
                  return (
                    <TableRow key={scan.id} className="relative">
                      <TableCell className="max-w-0 truncate pl-4 font-mono sm:max-w-none">
                        <Link href={href} className="after:absolute after:inset-0">
                          {hostFromUrl(appUrl)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{timeAgo(scan.createdAt)}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{flowCounts.get(scan.id) ?? 0}</TableCell>
                      <TableCell className="pr-4 text-right">
                        {scan.status === "done" ? (
                          <Badge variant="secondary" className={cx("rounded-md", health === "broken" ? "bg-bad-bg text-bad-ink" : health === "review" ? "bg-warn-bg text-warn" : "text-muted-foreground")}>
                            {health === "broken" ? `${attention} need attention` : health === "review" ? `${toCheck} to check` : flowCounts.get(scan.id) ? "All clear" : "Nothing tested"}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className={cx("rounded-md", scan.status === "running" || scan.status === "queued" ? "bg-live-bg text-live-ink" : "text-muted-foreground")}>
                            {STATUS_TEXT[scan.status]}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
