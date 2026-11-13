import { formatFixedResponse, KNOWN_CHAINS } from "@dappdrill/core";
import { db, makes } from "@dappdrill/db";
import { desc, eq } from "drizzle-orm";
import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteAppAction, removeNoteAction } from "@/actions/apps";
import { makeTestsAction } from "@/actions/tests";
import { ConfirmButton } from "@/components/confirm-button";
import { SettingsForm } from "@/components/settings-form";
import { SubmitButton } from "@/components/submit-button";
import { SetupEditor } from "@/components/tests/lines-editor";
import { PageHeader, SettingsSection } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";
import { isHostVerified } from "@/lib/domains";
import { timeAgo } from "@/lib/format";
import { ownerHints } from "@/lib/hints";
import { can } from "@/lib/permissions";
import { requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

/** The ones with a chip. Any other chain shows with its RPC URL. */
const CHAINS = KNOWN_CHAINS.filter((c) => c.id !== 31337 && c.forkable);

export default async function SettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app, role } = await requireApp(appId);
  const manage = can(role, "apps.manage");
  const [verified, [seen]] = await Promise.all([
    isHostVerified(app.organizationId, app.host),
    db().select({ id: makes.id, status: makes.status, state: makes.state, finishedAt: makes.finishedAt, createdAt: makes.createdAt }).from(makes).where(eq(makes.appId, app.id)).orderBy(desc(makes.createdAt)).limit(1),
  ]);
  // What our browser last saw there: the look's last picture, or a goal's.
  const making = seen?.status === "queued" || seen?.status === "running";
  const frame = seen ? artifactUrl("makes", seen.id, seen.state.frame ?? seen.state.goals.findLast((g) => g.frame)?.frame) : null;
  const setup = app.suite.setup && { startPath: app.suite.setup.startPath, steps: app.suite.setup.steps.map((s) => s.do) };
  // What the look and the maker wrote down about the app. The owner's own answers are in the form above.
  const learned = app.suite.notes.filter((n) => n.from !== "owner");
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
          hints: ownerHints(app.suite.notes),
          funding: app.settings.funding ?? "",
          signing: app.suite.signing,
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
        seen={!seen ? "Not opened yet" : making ? "Making tests now" : `Last opened ${timeAgo(seen.finishedAt ?? seen.createdAt)}`}
      />

      {/* The app page links here as #setup. */}
      <SettingsSection id="setup" title="Setup" hint="What every test needs first, like connecting the wallet or signing in. It is done once before the tests, so they don't repeat it.">
        <SetupEditor appId={app.id} setup={setup} canEdit={manage} />
      </SettingsSection>

      {learned.length > 0 && (
        <SettingsSection id="learned" title="What DappDrill learned" hint="Written down while looking over the app and making tests, and read each time a test is made or run. Take out any that are wrong.">
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {learned.map((n, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 text-pretty whitespace-pre-line">
                  {n.text}
                  {n.from === "unkept" && <span className="text-muted-foreground"> · from a test that wasn't kept</span>}
                </span>
                {manage && (
                  <form action={removeNoteAction.bind(null, app.id, n.text)}>
                    <SubmitButton variant="ghost" size="icon-sm" busy="" aria-label="Remove this note" className="text-muted-foreground">
                      <X aria-hidden="true" />
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      <SettingsSection id="make" title="Make more tests" hint="Looks over the app again and makes a test for what it hasn't got one for. Your tests stay as they are.">
        {making ? (
          <p className="text-sm text-muted-foreground">
            Making tests now.{" "}
            <Link href={`/apps/${app.id}`} className="text-foreground underline underline-offset-4">
              Watch it
            </Link>
          </p>
        ) : (
          <form action={makeTestsAction.bind(null, app.id)}>
            <SubmitButton variant="outline" size="sm" className="w-fit" busy="Starting…">
              Make more tests
            </SubmitButton>
          </form>
        )}
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
