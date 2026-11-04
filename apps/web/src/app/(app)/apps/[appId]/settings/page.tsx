import { formatFixedResponse, KNOWN_CHAINS } from "@dappdrill/core";
import type { Metadata } from "next";
import Link from "next/link";
import { analyzeAction, deleteAppAction } from "@/actions/apps";
import { ConfirmButton } from "@/components/confirm-button";
import { SettingsForm } from "@/components/settings-form";
import { SettingsSection } from "@/components/ui";
import { isHostVerified } from "@/lib/domains";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const verified = await isHostVerified(app.teamId, app.host);
  const known = new Set(KNOWN_CHAINS.map((c) => c.id));
  const custom = app.settings.chains.filter((c) => !KNOWN_CHAINS.some((k) => k.id === c.id && k.rpcUrl === c.rpcUrl));

  return (
    <div className="page flex flex-col gap-2">
      <header className="flex flex-col gap-1 pb-5">
        <h1 className="h1">Settings</h1>
        <p className="m-0 text-[15px] text-ink-3">How DappDrill opens {app.name}. Most apps need none of this.</p>
      </header>

      <SettingsForm
        appId={app.id}
        defaults={{
          name: app.name,
          url: app.url,
          hints: app.settings.hints ?? "",
          chains: app.settings.chains.filter((c) => known.has(c.id) && !custom.includes(c)).map((c) => c.id),
          customChains: custom.map((c) => `${c.id} ${c.rpcUrl}${c.mode === "live" ? " live" : ""}`).join("\n"),
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
      />

      <SettingsSection id="explore" title="Explore again" hint="Looks around the app again and adds flows it hasn't seen. Your tests stay as they are.">
        <form action={analyzeAction.bind(null, app.id)}>
          <button type="submit" className="btn btn-sm w-fit">
            Explore again
          </button>
        </form>
      </SettingsSection>

      <SettingsSection id="danger" title="Delete app" hint="Deletes its tests and every run. This can't be undone.">
        <ConfirmButton className="btn btn-sm w-fit" confirm="Click again to delete the app" onConfirm={deleteAppAction.bind(null, app.id)}>
          Delete {app.name}
        </ConfirmButton>
      </SettingsSection>

      <p className="hint m-0 pt-4">
        Test wallets, domains and alerts are shared by the team: <Link href="/account">Account</Link>.
      </p>
    </div>
  );
}
