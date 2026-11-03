import { DEFAULT_EDGE_CASES } from "@dappdrill/core";
import type { Metadata } from "next";
import { NewScanForm, type NewScanDefaults } from "@/components/scan/new-scan-form";
import { cx, ItemList, ListItem, PageHeader, RowLink } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
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
          <ItemList>
            {recent.map(({ scan, appUrl }) => {
              const c = counts.get(scan.id);
              const health = healthOfCounts(c);
              const attention = c ? c.critical + c.high : 0;
              const toCheck = c ? c.medium + c.low : 0;
              const flowsFound = flowCounts.get(scan.id) ?? 0;
              return (
                <ListItem key={scan.id}>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full min-w-0">
                      <RowLink href={`/apps/${scan.appId}/scans/${scan.id}`} className="truncate">
                        {hostFromUrl(appUrl)}
                      </RowLink>
                    </ItemTitle>
                    <ItemDescription className="text-xs">{[timeAgo(scan.createdAt), flowsFound ? `${plural(flowsFound, "flow")} found` : null].filter(Boolean).join(" · ")}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="pointer-events-none">
                    {scan.status === "done" ? (
                      <Badge variant="secondary" className={cx("rounded-md", health === "broken" ? "bg-bad-bg text-bad-ink" : health === "review" ? "bg-warn-bg text-warn" : "text-muted-foreground")}>
                        {health === "broken" ? `${attention} need attention` : health === "review" ? `${toCheck} to check` : flowsFound ? "All clear" : "Nothing tested"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className={cx("rounded-md", scan.status === "running" || scan.status === "queued" ? "bg-live-bg text-live-ink" : "text-muted-foreground")}>
                        {STATUS_TEXT[scan.status]}
                      </Badge>
                    )}
                  </ItemActions>
                </ListItem>
              );
            })}
          </ItemList>
        </section>
      )}
    </div>
  );
}
