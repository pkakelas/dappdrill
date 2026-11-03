import { DEFAULT_EDGE_CASES } from "@dappdrill/core";
import type { Metadata } from "next";
import { NewScanForm, type NewScanDefaults } from "@/components/scan/new-scan-form";
import { JobStatus, List, ListRow, Mono, Section } from "@/components/ui";
import { plural, hostFromUrl, timeAgo } from "@/lib/format";
import { PLANS, scanAllowance } from "@/lib/plan";
import { flowCountsByScan, healthOfCounts, issueCounts, recentScans } from "@/lib/queries";
import { currentTeam, requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "New scan" };

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
      }
    : { url: "", chains: [], wallets: ["metamask", "rabby"], edgeCases: DEFAULT_EDGE_CASES, hints: "", allowMainnetLive: false, liveKeyAddress: null };

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
    <div className="page gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="h1 max-w-[20ch]">Paste a URL. We&apos;ll use it like a real user would.</h1>
        <p className="lead max-w-[640px]">
          DappDrill opens your dApp with its own wallet on a fork of each chain, walks every flow it can find, and makes the wallet mistakes real users make. Nothing touches mainnet.
        </p>
      </header>

      <NewScanForm key={app?.id ?? "new"} defaults={defaults} usage={usage} />

      {recent.length > 0 && (
        <Section title="Recent scans">
          <List>
            {recent.map(({ scan, appUrl }) => {
              const c = counts.get(scan.id);
              const health = healthOfCounts(c);
              const flowsFound = flowCounts.get(scan.id) ?? 0;
              return (
                <ListRow
                  key={scan.id}
                  href={`/apps/${scan.appId}/scans/${scan.id}`}
                  title={<Mono className="block truncate text-sm">{hostFromUrl(appUrl)}</Mono>}
                  meta={`${timeAgo(scan.createdAt)} · ${plural(flowsFound, "flow")}`}
                  aside={
                    <JobStatus status={scan.status} health={health}>
                      {health === "broken" ? `${c!.critical + c!.high} need attention` : health === "review" ? `${c!.medium + c!.low} to check` : flowsFound ? "All clear" : "Nothing tested"}
                    </JobStatus>
                  }
                />
              );
            })}
          </List>
        </Section>
      )}
    </div>
  );
}
