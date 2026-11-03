import { apiTokens, db, domains, integrations, invites, teamMembers, testWallets, user as users } from "@dappdrill/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import {
  addDomainAction,
  cancelInviteAction,
  createInboxAction,
  createTokenAction,
  inviteAction,
  removeDomainAction,
  removeInboxAction,
  removeIntegrationAction,
  removeMemberAction,
  revokeTokenAction,
  saveIntegrationAction,
  setIntegrationEnabledAction,
  verifyDomainAction,
} from "@/actions/account";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/report/copy-button";
import { Addr, cx, List, SettingsSection } from "@/components/ui";
import { env } from "@/lib/env";
import { plural, timeAgo } from "@/lib/format";
import { PLANS, replaysThisMonth, scanAllowance } from "@/lib/plan";
import { currentTeam, teamApps } from "@/lib/session";

export const metadata: Metadata = { title: "Account" };

type Integration = typeof integrations.$inferSelect;

export default async function AccountPage() {
  const { user, team, role } = await currentTeam();
  const apps = await teamApps(team.id);
  const appIds = apps.map((a) => a.id);
  const [allowances, replays, [wallets], domainRows, integrationRows, tokenRows, members, pending] = await Promise.all([
    Promise.all(apps.map((a) => scanAllowance(a.id, team.plan))),
    replaysThisMonth(appIds),
    db().select().from(testWallets).where(eq(testWallets.teamId, team.id)),
    db().select().from(domains).where(eq(domains.teamId, team.id)).orderBy(asc(domains.createdAt)),
    db().select().from(integrations).where(eq(integrations.teamId, team.id)),
    appIds.length ? db().select().from(apiTokens).where(inArray(apiTokens.appId, appIds)).orderBy(asc(apiTokens.createdAt)) : [],
    db()
      .select({ id: users.id, name: users.name, email: users.email, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, team.id))
      .orderBy(asc(teamMembers.createdAt)),
    db().select().from(invites).where(and(eq(invites.teamId, team.id), isNull(invites.acceptedAt))).orderBy(asc(invites.createdAt)),
  ]);
  const plan = PLANS[team.plan];
  const integ = new Map(integrationRows.map((i) => [i.kind, i]));

  return (
    <div className="page flex flex-col gap-2">
      <header className="flex flex-col gap-1 pb-5">
        <h1 className="h1">Account</h1>
        <p className="m-0 text-[15px] text-ink-3">
          {user.name || user.email} · {role === "owner" ? "Owner" : "Member"} of {team.name}
        </p>
      </header>

      <SettingsSection id="plan" title="Plan" hint="Replays are always unlimited. Only discovery scans count.">
        <div className="card flex flex-col gap-5 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-lg font-semibold">{plan.name}</span>
            <span className="text-sm text-muted">{plan.price}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {apps.length === 0 ? (
              <Meter label="Discovery scans" value="—" />
            ) : (
              apps.map((a, i) => {
                const al = allowances[i]!;
                return (
                  <Meter
                    key={a.id}
                    label={apps.length > 1 ? `Scans · ${a.name}` : "Discovery scans"}
                    value={al.unlimited ? `${al.used} (no limit in dev)` : `${al.used} of ${al.limit}`}
                    fill={al.unlimited ? 0 : al.used / al.limit}
                  />
                );
              })
            )}
            <Meter label="Replays this month" value={String(replays)} />
            <Meter label="Apps" value={String(apps.length)} />
          </div>
          {env.dev && <p className="hint m-0">DAPPDRILL_DEV is on: scan limits are lifted.</p>}
        </div>
        <p className="hint m-0">Billing isn&apos;t connected in this build. Each app is its own subscription.</p>
      </SettingsSection>

      <SettingsSection id="wallets" title="Test wallets" hint="Created and funded on every fork. They never hold real funds.">
        <List>
          <Row title="Test account A" detail={<Addr value={wallets?.accountAAddress} chars={6} />} aside={wallets && <CopyButton text={wallets.accountAAddress} label="Copy" className="btn-xs" />} />
          <Row
            title="Test account B"
            detail={
              <>
                <Addr value={wallets?.accountBAddress} chars={6} /> · used for account-switch tests
              </>
            }
            aside={wallets && <CopyButton text={wallets.accountBAddress} label="Copy" className="btn-xs" />}
          />
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">Embedded wallet login</span>
              <span className="text-[13px] text-muted">
                {wallets?.inboxAddress ? (
                  <>
                    <span className="font-mono">{wallets.inboxAddress}</span> · codes are read for you
                  </>
                ) : (
                  "A disposable inbox for Privy, Dynamic and Web3Auth email codes."
                )}
              </span>
            </div>
            {wallets?.inboxAddress ? (
              <form action={removeInboxAction}>
                <button type="submit" className="btn btn-xs">
                  Remove
                </button>
              </form>
            ) : (
              <ActionForm action={createInboxAction} className="items-end">
                <button type="submit" className="btn btn-sm">
                  Create inbox
                </button>
              </ActionForm>
            )}
          </li>
          {apps
            .filter((a) => a.liveKeyAddress)
            .map((a) => (
              <Row key={a.id} title={`Funded account · ${a.name}`} detail={<Addr value={a.liveKeyAddress} chars={6} />} aside={<Link href={`/new?app=${a.id}`} className="btn-link">Change</Link>} />
            ))}
        </List>
        {apps[0] && (
          <p className="hint m-0">
            Testing on a chain that can&apos;t be forked? Add a funded testnet key under <Link href={`/new?app=${apps[0].id}`}>New scan → Customize</Link>.
          </p>
        )}
      </SettingsSection>

      <SettingsSection id="domains" title="Domains" hint="Scheduled and CI runs need a verified domain, so DappDrill only drills sites you own.">
        {domainRows.length > 0 && (
          <List>
            {domainRows.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-sm">{d.host}</span>
                  <div className="flex items-center gap-2">
                    {d.verifiedAt ? <span className="pill bg-hair text-ink-2">Verified</span> : <span className="pill bg-warn-bg text-warn">Not verified</span>}
                    <form action={removeDomainAction}>
                      <input type="hidden" name="domainId" value={d.id} />
                      <button type="submit" className="btn btn-xs" aria-label={`Remove ${d.host}`}>
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
                {!d.verifiedAt && (
                  <div className="flex flex-col gap-2 text-[13px] text-ink-2">
                    <span>Do one of these, then press Verify:</span>
                    <span>
                      Serve <code className="font-mono">https://{d.host}/.well-known/dappdrill.txt</code> containing <code className="font-mono">{d.token}</code>
                    </span>
                    <span>
                      Or add a DNS TXT record on <code className="font-mono">{d.host}</code>: <code className="font-mono">dappdrill-verify={d.token}</code>
                    </span>
                    <ActionForm action={verifyDomainAction}>
                      <input type="hidden" name="domainId" value={d.id} />
                      <button type="submit" className="btn btn-sm w-fit">
                        Verify
                      </button>
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </List>
        )}
        <ActionForm action={addDomainAction}>
          <div className="flex gap-2">
            <label htmlFor="host" className="sr-only">
              Domain
            </label>
            <input id="host" name="host" required className="field min-w-0 flex-1 font-mono" placeholder="app.example.com" autoComplete="off" />
            <button type="submit" className="btn">
              Add a domain
            </button>
          </div>
        </ActionForm>
        {env.dev && <p className="hint m-0">In dev mode, localhost counts as verified.</p>}
      </SettingsSection>

      <SettingsSection id="integrations" title="Integrations" hint="Where alerts go when a run finds something new.">
        <List>
          <IntegrationRow kind="github" title="GitHub" row={integ.get("github")} status={(r) => `Issues open in ${r.config.repo}`}>
            <Field name="repo" label="Repository" placeholder="owner/name" defaultValue={integ.get("github")?.config.repo} mono />
          </IntegrationRow>
          <IntegrationRow kind="slack" title="Slack" row={integ.get("slack")} status={(r) => `Alerts to ${r.config.channel ?? "your webhook"}`}>
            <Field name="secret" label="Incoming Webhook URL" placeholder={integ.get("slack") ? "Saved. Paste a new one to replace it." : "https://hooks.slack.com/services/…"} type="password" mono />
            <Field name="channel" label="Channel name (for your reference)" placeholder="#qa" defaultValue={integ.get("slack")?.config.channel} />
          </IntegrationRow>
          <IntegrationRow kind="telegram" title="Telegram" row={integ.get("telegram")} status={(r) => `Alerts to chat ${r.config.chatId}`}>
            <Field name="secret" label="Bot token" placeholder={integ.get("telegram") ? "Saved. Paste a new one to replace it." : "123456:ABC…"} type="password" mono />
            <Field name="chatId" label="Chat id" placeholder="-1001234567890" defaultValue={integ.get("telegram")?.config.chatId} mono />
          </IntegrationRow>
          <IntegrationRow kind="email" title="Email" row={integ.get("email")} status={(r) => `Alerts to ${r.config.to}`}>
            <Field name="to" label="Send alerts to" placeholder="qa@example.com, dev@example.com" defaultValue={integ.get("email")?.config.to} />
          </IntegrationRow>
        </List>
      </SettingsSection>

      <SettingsSection id="tokens" title="API tokens" hint="For the CLI and the GitHub Action: pull this app's flows and report results. One token per app.">
        {apps.length === 0 ? (
          <p className="hint m-0">Add an app first.</p>
        ) : (
          apps.map((a) => {
            const tokens = tokenRows.filter((t) => t.appId === a.id);
            return (
              <div key={a.id} className="flex flex-col gap-3">
                {apps.length > 1 && <h3 className="m-0 text-sm font-semibold">{a.name}</h3>}
                {tokens.length > 0 && (
                  <List>
                    {tokens.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <span className="flex flex-col">
                          <span className="text-sm font-medium">{t.name}</span>
                          <span className="text-[13px] text-muted">
                            Created {timeAgo(t.createdAt)} · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : "never used"}
                          </span>
                        </span>
                        <form action={revokeTokenAction}>
                          <input type="hidden" name="tokenId" value={t.id} />
                          <button type="submit" className="btn btn-xs">
                            Revoke
                          </button>
                        </form>
                      </li>
                    ))}
                  </List>
                )}
                <ActionForm action={createTokenAction} secretLabel="Add it to your repo as the DAPPDRILL_TOKEN secret.">
                  <input type="hidden" name="appId" value={a.id} />
                  <div className="flex gap-2">
                    <label htmlFor={`tok-${a.id}`} className="sr-only">
                      Token name
                    </label>
                    <input id={`tok-${a.id}`} name="name" required maxLength={60} className="field min-w-0 flex-1" placeholder="GitHub Action" defaultValue="GitHub Action" />
                    <button type="submit" className="btn">
                      Create token
                    </button>
                  </div>
                </ActionForm>
              </div>
            );
          })
        )}
        <details className="card px-5 py-4">
          <summary className="btn-link w-fit cursor-pointer">GitHub Action setup</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="m-0 text-[13px] text-ink-2">
              Save as <code className="font-mono">.github/workflows/dappdrill.yml</code>. It replays your saved flows on every pull request, comments the result, and reports back here.
            </p>
            <pre className="codeblock m-0 overflow-x-auto">{actionSnippet(apps[0]?.url)}</pre>
            <CopyButton text={actionSnippet(apps[0]?.url)} label="Copy workflow" className="w-fit" />
          </div>
        </details>
      </SettingsSection>

      <SettingsSection id="team" title="Team" hint="Everyone can run flows and change settings. Owners invite and remove people.">
        <List>
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  {m.name || m.email}
                  {m.id === user.id && <span className="text-muted"> (you)</span>}
                </span>
                <span className="text-[13px] text-muted">{m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[13px] text-muted">{m.role === "owner" ? "Owner" : "Member"}</span>
                {role === "owner" && m.id !== user.id && (
                  <form action={removeMemberAction}>
                    <input type="hidden" name="userId" value={m.id} />
                    <button type="submit" className="btn btn-xs" aria-label={`Remove ${m.email}`}>
                      Remove
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
          {pending.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <span className="flex flex-col">
                <span className="text-sm">{i.email}</span>
                <span className="text-[13px] text-muted">Invited {timeAgo(i.createdAt)}</span>
              </span>
              {role === "owner" && (
                <form action={cancelInviteAction}>
                  <input type="hidden" name="inviteId" value={i.id} />
                  <button type="submit" className="btn btn-xs">
                    Cancel invite
                  </button>
                </form>
              )}
            </li>
          ))}
        </List>
        {role === "owner" && (
          <ActionForm action={inviteAction}>
            <div className="flex gap-2">
              <label htmlFor="invite" className="sr-only">
                Email
              </label>
              <input id="invite" name="email" type="email" required className="field min-w-0 flex-1" placeholder="teammate@example.com" />
              <button type="submit" className="btn">
                Invite someone
              </button>
            </div>
          </ActionForm>
        )}
        <p className="hint m-0">{plural(members.length, "person", "people")} on {team.name}.</p>
      </SettingsSection>
    </div>
  );
}

function actionSnippet(url?: string): string {
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
          url: ${url ?? "https://your-preview-url"}
          pull: "true"
          report-to: ${env.appUrl}
          token: \${{ secrets.DAPPDRILL_TOKEN }}
`;
}

function Meter({ label, value, fill }: { label: string; value: string; fill?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[17px] font-semibold tabular-nums">{value}</span>
      {fill !== undefined && (
        <span className="h-1.5 overflow-hidden rounded-full bg-hair">
          <span className={cx("block h-full rounded-full", fill >= 1 ? "bg-bad" : "bg-ink")} style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }} />
        </span>
      )}
    </div>
  );
}

function Row({ title, detail, aside }: { title: string; detail: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[13px] text-muted">{detail}</span>
      </span>
      {aside}
    </li>
  );
}

function Field({ name, label, placeholder, defaultValue, type = "text", mono }: { name: string; label: string; placeholder?: string; defaultValue?: string; type?: string; mono?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} className={cx("field", mono && "font-mono text-sm")} autoComplete="off" />
    </label>
  );
}

function IntegrationRow({ kind, title, row, status, children }: { kind: Integration["kind"]; title: string; row?: Integration; status: (r: Integration) => string; children: React.ReactNode }) {
  return (
    <li className="px-5 py-4">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-[13px] text-muted">{row ? (row.enabled ? status(row) : `Paused · ${status(row)}`) : "Not connected"}</span>
          </span>
          <span className="btn btn-sm">{row ? "Manage" : "Connect"}</span>
        </summary>
        <div className="mt-4 flex flex-col gap-3">
          <ActionForm action={saveIntegrationAction}>
            <input type="hidden" name="kind" value={kind} />
            {children}
            <button type="submit" className="btn btn-sm btn-primary w-fit">
              Save
            </button>
          </ActionForm>
          {row && (
            <div className="flex gap-2">
              <form action={setIntegrationEnabledAction}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="enabled" value={row.enabled ? "0" : "1"} />
                <button type="submit" className="btn btn-xs">
                  {row.enabled ? "Pause" : "Resume"}
                </button>
              </form>
              <form action={removeIntegrationAction}>
                <input type="hidden" name="kind" value={kind} />
                <button type="submit" className="btn btn-xs">
                  Disconnect
                </button>
              </form>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
