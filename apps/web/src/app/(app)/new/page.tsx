import { DEFAULT_EDGE_CASES } from "@dappdrill/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewScanForm } from "@/components/scan/new-scan-form";
import { plural } from "@/lib/format";
import { PLANS } from "@/lib/plan";
import { currentTeam } from "@/lib/session";

export const metadata: Metadata = { title: "Add an app" };

/** Adding an app. Existing apps rescan from the header and change settings under Settings. */
export default async function NewAppPage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  const { app } = await searchParams;
  if (app) redirect(`/apps/${app}/settings`);
  const { team } = await currentTeam();
  const plan = PLANS[team.plan];

  return (
    <div className="page gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="h1 max-w-[20ch]">Paste a URL. We&apos;ll use it like a real user would.</h1>
        <p className="lead max-w-[640px]">
          DappDrill opens your dApp with its own wallet on a fork of each chain, walks every flow it can find, and makes the wallet mistakes real users make. Nothing touches mainnet.
        </p>
      </header>

      <NewScanForm
        defaults={{ url: "", chains: [], wallets: ["metamask", "rabby"], edgeCases: DEFAULT_EDGE_CASES, hints: "", allowMainnetLive: false, liveKeyAddress: null }}
        usage={`${plan.name}: ${plural(plan.scansPerMonth, "discovery scan")} per app each month`}
      />

      <ol className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-3">
        {[
          ["Scan", "The agent explores the app with a test wallet and saves every flow it finds."],
          ["Review", "Each flow is replayed under wallet edge cases. You see what broke and every signature request."],
          ["Keep it checked", "Run the saved flows daily or on every pull request. Replays are unlimited."],
        ].map(([title, text], i) => (
          <li key={title} className="flex flex-col gap-1.5 border-t border-line pt-4">
            <span className="font-mono text-meta text-faint">{String(i + 1).padStart(2, "0")}</span>
            <span className="title">{title}</span>
            <p className="hint m-0">{text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
