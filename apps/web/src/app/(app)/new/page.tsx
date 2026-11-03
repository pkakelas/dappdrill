import { DEFAULT_EDGE_CASES } from "@dappdrill/core";
import type { Metadata } from "next";
import Link from "next/link";
import { NewScanForm, type NewScanDefaults } from "@/components/scan/new-scan-form";
import { cx } from "@/components/ui";
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
    <div className="page flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="h1 max-w-[20ch]">Paste a URL. We&apos;ll use it like a real user would.</h1>
        <p className="m-0 max-w-[640px] text-[17px] leading-relaxed text-ink-3">
          DappDrill opens your dApp with its own wallet on a fork of each chain, walks every flow it can find, and makes the wallet mistakes real users make. Nothing touches mainnet.
        </p>
      </header>

      <NewScanForm key={app?.id ?? "new"} defaults={defaults} usage={usage} />

      {recent.length > 0 && (
        <section aria-labelledby="recent" className="flex flex-col gap-3">
          <h2 id="recent" className="eyebrow">
            Recent scans
          </h2>
          <ul className="card m-0 list-none divide-y divide-divide overflow-hidden p-0">
            {recent.map(({ scan, appUrl }) => {
              const c = counts.get(scan.id);
              const health = healthOfCounts(c);
              const attention = c ? c.critical + c.high : 0;
              const toCheck = c ? c.medium + c.low : 0;
              return (
                <li key={scan.id}>
                  <Link
                    href={`/apps/${scan.appId}/scans/${scan.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-4 no-underline hover:bg-sub sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]"
                  >
                    <span className="truncate font-mono text-sm">{hostFromUrl(appUrl)}</span>
                    <span className="text-[13px] text-muted sm:order-none">{timeAgo(scan.createdAt)}</span>
                    <span className="hidden text-[13px] text-muted sm:inline">{plural(flowCounts.get(scan.id) ?? 0, "flow")}</span>
                    <span className="col-span-2 justify-self-start sm:col-span-1">
                      {scan.status === "done" ? (
                        <span className={cx("pill", health === "broken" ? "bg-bad-bg text-bad" : health === "review" ? "bg-warn-bg text-warn" : "bg-hair text-muted")}>
                          {health === "broken" ? `${attention} need attention` : health === "review" ? `${toCheck} to check` : flowCounts.get(scan.id) ? "All clear" : "Nothing tested"}
                        </span>
                      ) : scan.status === "running" || scan.status === "queued" ? (
                        <span className="pill bg-live-bg text-live-ink">{STATUS_TEXT[scan.status]}</span>
                      ) : (
                        <span className="pill bg-hair text-muted">{STATUS_TEXT[scan.status]}</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
