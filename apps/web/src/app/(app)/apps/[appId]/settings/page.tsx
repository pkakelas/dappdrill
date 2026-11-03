import { apiTokens, db, domains } from "@dappdrill/db";
import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { addDomainAction, createTokenAction, revokeTokenAction } from "@/actions/account";
import { ActionForm } from "@/components/action-form";
import { ScheduleForm } from "@/components/flows/forms";
import { CopyButton } from "@/components/report/copy-button";
import { ScanSettingsForm } from "@/components/scan/new-scan-form";
import { DomainItem, InlineAdd } from "@/components/settings";
import { ActionButton, Disclosure, Hidden, List, ListRow, Mono, Notice, PageHeader, SettingsSection, SubmitButton } from "@/components/ui";
import { isHostVerified } from "@/lib/domains";
import { env } from "@/lib/env";
import { timeAgo } from "@/lib/format";
import { PLANS, scanAllowance } from "@/lib/plan";
import { currentTeam, requireApp } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

type Props = { params: Promise<{ appId: string }>; searchParams: Promise<{ error?: string }> };

const SECTIONS = [
  ["scan", "Scanning"],
  ["domain", "Domain"],
  ["schedule", "Schedule"],
  ["ci", "Pull requests"],
] as const;

/** Everything that belongs to one app: what a scan tests, where runs may go, and when they run. */
export default async function SettingsPage({ params, searchParams }: Props) {
  const { appId } = await params;
  const { error } = await searchParams;
  const { app } = await requireApp(appId);
  const { team } = await currentTeam();
  const [allowance, [domain], verified, tokens] = await Promise.all([
    scanAllowance(app.id, team.plan),
    db().select().from(domains).where(and(eq(domains.teamId, app.teamId), eq(domains.host, app.host))),
    isHostVerified(app.teamId, app.host),
    db().select().from(apiTokens).where(eq(apiTokens.appId, app.id)).orderBy(asc(apiTokens.createdAt)),
  ]);
  const usage = allowance.unlimited
    ? "Dev mode: scans aren't counted"
    : allowance.left > 0
      ? `${allowance.left} of ${allowance.limit} scans left this month`
      : `No scans left this month (${PLANS[team.plan].name} plan)`;

  return (
    <div className="page !gap-0">
      <PageHeader title="Settings" sub={<Mono className="text-sm text-muted">{app.host}</Mono>}>
        <nav className="seg mt-3" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}-section`}>
              {label}
            </a>
          ))}
        </nav>
      </PageHeader>

      {error && (
        <Notice tone="bad" role="alert" className="mt-6">
          {error}
        </Notice>
      )}

      <div className="mt-6 flex flex-col">
        <SettingsSection id="scan" title="Scanning" hint="What a discovery scan tests. The Scan button in the header uses these.">
          <ScanSettingsForm
            usage={usage}
            defaults={{
              appId: app.id,
              url: app.url,
              chains: app.settings.chains,
              wallets: app.settings.wallets,
              edgeCases: app.settings.edgeCases,
              hints: app.settings.hints ?? "",
              allowMainnetLive: Boolean(app.settings.allowMainnetLive),
              liveKeyAddress: app.liveKeyAddress,
            }}
          />
        </SettingsSection>

        <SettingsSection id="domain" title="Domain" hint="Scheduled and pull-request runs only go to a domain you've proven you own. Scans you start yourself don't need it.">
          {domain ? (
            <List>
              <DomainItem domain={domain} removable={false} />
            </List>
          ) : verified ? (
            <p className="meta m-0">
              <Mono>{app.host}</Mono> counts as verified in dev mode.
            </p>
          ) : (
            <ActionForm action={addDomainAction}>
              <Hidden fields={{ host: app.host }} />
              <p className="meta m-0">
                <Mono>{app.host}</Mono> isn&apos;t verified yet.
              </p>
              <SubmitButton className="w-fit" pendingText="Adding…">
                Verify {app.host}
              </SubmitButton>
            </ActionForm>
          )}
        </SettingsSection>

        <SettingsSection id="schedule" title="Schedule" hint="Replays every saved flow once a day. Replays don't use your scan allowance.">
          <ScheduleForm appId={app.id} time={app.scheduleTime} verified={verified} host={app.host} />
        </SettingsSection>

        <SettingsSection id="ci" title="Pull requests" hint="The GitHub Action replays your flows on every pull request, comments the result and reports back here.">
          {tokens.length > 0 && (
            <List>
              {tokens.map((t) => (
                <ListRow
                  key={t.id}
                  title={t.name}
                  meta={`Created ${timeAgo(t.createdAt)} · ${t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : "never used"}`}
                  aside={
                    <ActionButton action={revokeTokenAction} fields={{ tokenId: t.id }} className="btn-xs" confirm="Revoke it?">
                      Revoke
                    </ActionButton>
                  }
                />
              ))}
            </List>
          )}
          <ActionForm action={createTokenAction} secretLabel="Add it to your repo as the DAPPDRILL_TOKEN secret. It won't be shown again.">
            <Hidden fields={{ appId: app.id }} />
            <InlineAdd id="token-name" label="Token name" button={tokens.length ? "Create another token" : "Create a token"}>
              <input id="token-name" name="name" required maxLength={60} className="field min-w-0 flex-1" placeholder="GitHub Action" defaultValue="GitHub Action" />
            </InlineAdd>
          </ActionForm>
          <Disclosure summary="Workflow file" open={tokens.length === 0}>
            <div className="flex flex-col gap-3 p-4">
              <p className="meta m-0">
                Save as <Mono>.github/workflows/dappdrill.yml</Mono>.
              </p>
              <pre className="codeblock m-0 overflow-x-auto">{actionSnippet(app.url)}</pre>
              <CopyButton text={actionSnippet(app.url)} label="Copy workflow" className="w-fit" />
            </div>
          </Disclosure>
          <p className="hint m-0">
            Keeping flows in your repo? <Mono>DAPPDRILL_TOKEN=… dappdrill push-flows --report-to {env.appUrl}</Mono> uploads them.
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}

function actionSnippet(url: string): string {
  return `name: DappDrill
on: pull_request

jobs:
  dappdrill:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: dappdrill/dappdrill/.github/actions/dappdrill@main
        with:
          url: ${url}
          pull: "true"
          report-to: ${env.appUrl}
          token: \${{ secrets.DAPPDRILL_TOKEN }}
`;
}
