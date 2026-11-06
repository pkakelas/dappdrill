import { formatFixedResponse, KNOWN_CHAINS } from "@dappdrill/core";
import { db, explorations, latestRuns, tests } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteAppAction } from "@/actions/apps";
import { exploreAction } from "@/actions/explore";
import { ConfirmButton } from "@/components/confirm-button";
import { SettingsForm } from "@/components/settings-form";
import { lastSetup } from "@/components/tests/last-setup";
import { SetupCard } from "@/components/tests/setup-card";
import { PageHeader, SettingsSection } from "@/components/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";
import { isHostVerified } from "@/lib/domains";
import { timeAgo } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

/** The ones with a chip. Any other chain shows with its RPC URL. */
const CHAINS = KNOWN_CHAINS.filter((c) => c.id !== 31337 && c.forkable);

export default async function SettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app, role } = await requireApp(appId);
  const manage = can(role, "apps.manage");
  const [verified, [seen], testIds] = await Promise.all([
    isHostVerified(app.organizationId, app.host),
    db().select({ id: explorations.id, state: explorations.state, finishedAt: explorations.finishedAt, createdAt: explorations.createdAt }).from(explorations).where(eq(explorations.appId, app.id)).orderBy(desc(explorations.createdAt)).limit(1),
    db().select({ id: tests.id }).from(tests).where(eq(tests.appId, app.id)),
  ]);
  // What the first browser of the last pass saw: the app as it opens.
  const frame = seen ? artifactUrl("explorations", seen.id, seen.state?.explorers.find((e) => e.frame)?.frame) : null;
  const setup = app.setup && { startPath: app.setup.startPath, steps: app.setup.steps.map((s) => s.text), when: app.setup.when, why: app.setup.why };
  const setupRun = setup ? lastSetup(setup.steps, [...(await latestRuns(db(), testIds.map((t) => t.id))).values()]) : undefined;
  const others = app.settings.chains.filter((c) => !CHAINS.some((k) => k.id === c.id && k.rpcUrl === c.rpcUrl));

  return (
    <div className="page flex flex-col">
      <PageHeader title="Settings" description={`How DappDrill opens and tests ${app.name}.`} />

      <SettingsForm
        appId={app.id}
        readOnly={!manage}
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
        frame={frame}
        seen={seen ? `Last explored ${timeAgo(seen.finishedAt ?? seen.createdAt)}` : "Not explored yet"}
      />

      <SettingsSection id="setup" title="Setup" hint="Steps every test needs first, like signing in or getting test funds. They run before your tests, so the tests don't repeat them.">
        <SetupCard appId={app.id} setup={setup ?? null} last={setupRun} />
      </SettingsSection>

      <SettingsSection id="explore" title="Explore again" hint="Looks around the app again and adds what it hasn't seen. Your tests stay as they are.">
        <form action={exploreAction.bind(null, app.id)}>
          <Button type="submit" variant="outline" size="sm" className="w-fit">
            Explore again
          </Button>
        </form>
      </SettingsSection>

      {manage && (
        <SettingsSection id="danger" title="Delete app" hint="Deletes its tests and every run. This can't be undone.">
          <ConfirmButton className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit max-w-full" })} confirm="Click again to delete the app" onConfirm={deleteAppAction.bind(null, app.id)}>
            <span className="truncate">Delete {app.name}</span>
          </ConfirmButton>
        </SettingsSection>
      )}

      <p className="pt-4 text-sm text-muted-foreground">
        Test wallets, domains and alerts are shared by the organization:{" "}
        <Link href="/organization" className="underline underline-offset-4 hover:text-foreground">
          Organization settings
        </Link>
        .
      </p>
    </div>
  );
}
