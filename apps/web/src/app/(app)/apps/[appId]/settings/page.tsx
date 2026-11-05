import { formatFixedResponse, KNOWN_CHAINS } from "@dappdrill/core";
import { analyses, db } from "@dappdrill/db";
import { desc, eq, isNotNull, and } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction, deleteAppAction } from "@/actions/apps";
import { ConfirmButton } from "@/components/confirm-button";
import { SettingsForm } from "@/components/settings-form";
import { PageHeader, SettingsSection } from "@/components/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";
import { isHostVerified } from "@/lib/domains";
import { timeAgo } from "@/lib/format";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

/** The ones with a chip. Any other chain shows with its RPC URL. */
const CHAINS = KNOWN_CHAINS.filter((c) => c.id !== 31337 && c.forkable);

export default async function SettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const [verified, [seen]] = await Promise.all([
    isHostVerified(app.teamId, app.host),
    db()
      .select()
      .from(analyses)
      .where(and(eq(analyses.appId, app.id), isNotNull(analyses.liveFrame)))
      .orderBy(desc(analyses.createdAt))
      .limit(1),
  ]);
  const others = app.settings.chains.filter((c) => !CHAINS.some((k) => k.id === c.id && k.rpcUrl === c.rpcUrl));

  return (
    <div className="page flex flex-col">
      <PageHeader title="Settings" description={`How DappDrill opens and tests ${app.name}.`} />

      <SettingsForm
        appId={app.id}
        defaults={{
          name: app.name,
          url: app.url,
          hints: app.settings.hints ?? "",
          funding: app.settings.funding ?? "",
          chains: app.settings.chains.filter((c) => !others.includes(c)).map((c) => c.id),
          otherChains: others.map((c) => ({ rpcUrl: c.rpcUrl, chainId: c.id, testnet: c.mode === "live" })),
          wallets: app.settings.wallets,
          liveKeyAddress: app.liveKeyAddress,
          headerNames: app.accessHeaderNames,
          storage: Object.entries(app.settings.storage ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join("\n"),
          responses: (app.settings.responses ?? []).map(formatFixedResponse).join("\n"),
          schedule: app.scheduleTime ?? "",
          verified,
        }}
        frame={seen ? artifactUrl("analyses", seen.id, seen.liveFrame) : null}
        seen={seen ? `Last explored ${timeAgo(seen.finishedAt ?? seen.createdAt)}` : "Not explored yet"}
      />

      <SettingsSection id="explore" title="Explore again" hint="Looks around the app again and adds flows it hasn't seen. Your tests stay as they are.">
        <form action={analyzeAction.bind(null, app.id)}>
          <Button type="submit" variant="outline" size="sm" className="w-fit">
            Explore again
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection id="danger" title="Delete app" hint="Deletes its tests and every run. This can't be undone.">
        <ConfirmButton className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })} confirm="Click again to delete the app" onConfirm={deleteAppAction.bind(null, app.id)}>
          Delete {app.name}
        </ConfirmButton>
      </SettingsSection>

      <p className="pt-4 text-sm text-muted-foreground">
        Test wallets, domains and alerts are shared by the team:{" "}
        <Link href="/account" className="underline underline-offset-4 hover:text-foreground">
          Account
        </Link>
        .
      </p>
    </div>
  );
}
