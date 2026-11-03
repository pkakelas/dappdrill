import { db, domains, integrations, invites, teamMembers, testWallets, user as users } from "@dappdrill/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import {
  addDomainAction,
  cancelInviteAction,
  createInboxAction,
  inviteAction,
  removeInboxAction,
  removeIntegrationAction,
  removeMemberAction,
  saveIntegrationAction,
  setIntegrationEnabledAction,
} from "@/actions/account";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/report/copy-button";
import { DomainItem, InlineAdd } from "@/components/settings";
import { ActionButton, Addr, ChevronIcon, cx, Field, Hidden, List, ListRow, Meter, Mono, PageHeader, Pill, SettingsSection, SubmitButton } from "@/components/ui";
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
  const [allowances, replays, [wallets], domainRows, integrationRows, members, pending] = await Promise.all([
    Promise.all(apps.map((a) => scanAllowance(a.id, team.plan))),
    replaysThisMonth(appIds),
    db().select().from(testWallets).where(eq(testWallets.teamId, team.id)),
    db().select().from(domains).where(eq(domains.teamId, team.id)).orderBy(asc(domains.createdAt)),
    db().select().from(integrations).where(eq(integrations.teamId, team.id)),
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

  const sections = [
    ["plan", "Plan"],
    ["wallets", "Test wallets"],
    ["domains", "Domains"],
    ["integrations", "Alerts"],
    ["team", "Team"],
  ] as const;

  return (
    <div className="page !gap-0">
      <PageHeader title="Account" sub={`${user.name || user.email} · ${role === "owner" ? "Owner" : "Member"} of ${team.name}`}>
        <nav className="seg mt-3" aria-label="Account sections">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}-section`}>
              {label}
            </a>
          ))}
        </nav>
      </PageHeader>

      <div className="mt-6 flex flex-col">
        <SettingsSection id="plan" title="Plan" hint="Replays are always unlimited. Only discovery scans count.">
          <div className="card flex flex-col gap-5 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="title">{plan.name}</span>
              <span className="meta">{plan.price}</span>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              {apps.length === 0 ? (
                <Meter label="Discovery scans" value="—" />
              ) : (
                apps.map((a, i) => {
                  const al = allowances[i]!;
                  return (
                    <Meter
                      key={a.id}
                      label={apps.length > 1 ? `Scans · ${a.name}` : "Discovery scans"}
                      value={al.unlimited ? `${al.used}` : `${al.used} of ${al.limit}`}
                      fill={al.unlimited ? undefined : al.used / al.limit}
                    />
                  );
                })
              )}
              <Meter label="Replays this month" value={replays} />
              <Meter label="Apps" value={apps.length} />
            </div>
            {env.dev && <p className="hint m-0">DAPPDRILL_DEV is on: scan limits are lifted.</p>}
          </div>
          <p className="hint m-0">Billing isn&apos;t connected in this build. Each app is its own subscription.</p>
        </SettingsSection>

        <SettingsSection id="wallets" title="Test wallets" hint="Created and funded on every fork. They never hold real funds.">
          <List>
            <ListRow title="Test account A" meta={<Addr value={wallets?.accountAAddress} chars={6} />} aside={wallets && <CopyButton text={wallets.accountAAddress} label="Copy" className="btn-xs" />} />
            <ListRow
              title="Test account B"
              meta={
                <>
                  <Addr value={wallets?.accountBAddress} chars={6} /> · used for account-switch tests
                </>
              }
              aside={wallets && <CopyButton text={wallets.accountBAddress} label="Copy" className="btn-xs" />}
            />
            <ListRow
              title="Embedded wallet login"
              meta={
                wallets?.inboxAddress ? (
                  <>
                    <Mono>{wallets.inboxAddress}</Mono> · codes are read for you
                  </>
                ) : (
                  "A disposable inbox for Privy, Dynamic and Web3Auth email codes."
                )
              }
              aside={
                wallets?.inboxAddress ? (
                  <ActionButton action={removeInboxAction} className="btn-xs" confirm="Remove inbox?">
                    Remove
                  </ActionButton>
                ) : (
                  <ActionForm action={createInboxAction} className="items-end">
                    <SubmitButton className="btn-sm" pendingText="Creating…">
                      Create inbox
                    </SubmitButton>
                  </ActionForm>
                )
              }
            />
          </List>
          <p className="hint m-0">Funded testnet keys, for chains that can&apos;t be forked, are set per app under Settings → Scanning.</p>
        </SettingsSection>

        <SettingsSection id="domains" title="Domains" hint="Scheduled and pull-request runs need a verified domain, so DappDrill only drills sites you own. Shared by all your apps.">
          {domainRows.length > 0 && (
            <List>
              {domainRows.map((d) => (
                <DomainItem key={d.id} domain={d} />
              ))}
            </List>
          )}
          <ActionForm action={addDomainAction}>
            <InlineAdd id="host" label="Domain" button="Add a domain">
              <input id="host" name="host" required className="field min-w-0 flex-1 font-mono" placeholder="app.example.com" autoComplete="off" />
            </InlineAdd>
          </ActionForm>
          {env.dev && <p className="hint m-0">In dev mode, localhost counts as verified.</p>}
        </SettingsSection>

        <SettingsSection id="integrations" title="Alerts" hint="Where alerts go when a run finds something new, for every app.">
          <List>
            <IntegrationRow kind="github" title="GitHub" row={integ.get("github")} status={(r) => `Issues open in ${r.config.repo}`}>
              <TextField name="repo" label="Repository" placeholder="owner/name" defaultValue={integ.get("github")?.config.repo} mono />
            </IntegrationRow>
            <IntegrationRow kind="slack" title="Slack" row={integ.get("slack")} status={(r) => `Alerts to ${r.config.channel ?? "your webhook"}`}>
              <TextField name="secret" label="Incoming Webhook URL" placeholder={integ.get("slack") ? "Saved. Paste a new one to replace it." : "https://hooks.slack.com/services/…"} type="password" mono />
              <TextField name="channel" label="Channel name" hint="For your reference." placeholder="#qa" defaultValue={integ.get("slack")?.config.channel} />
            </IntegrationRow>
            <IntegrationRow kind="telegram" title="Telegram" row={integ.get("telegram")} status={(r) => `Alerts to chat ${r.config.chatId}`}>
              <TextField name="secret" label="Bot token" placeholder={integ.get("telegram") ? "Saved. Paste a new one to replace it." : "123456:ABC…"} type="password" mono />
              <TextField name="chatId" label="Chat id" placeholder="-1001234567890" defaultValue={integ.get("telegram")?.config.chatId} mono />
            </IntegrationRow>
            <IntegrationRow kind="email" title="Email" row={integ.get("email")} status={(r) => `Alerts to ${r.config.to}`}>
              <TextField name="to" label="Send alerts to" placeholder="qa@example.com, dev@example.com" defaultValue={integ.get("email")?.config.to} />
            </IntegrationRow>
          </List>
        </SettingsSection>

        <SettingsSection id="team" title="Team" hint="Everyone can run flows and change settings. Owners invite and remove people.">
          <List>
            {members.map((m) => (
              <ListRow
                key={m.id}
                title={
                  <>
                    {m.name || m.email}
                    {m.id === user.id && <span className="font-normal text-muted"> (you)</span>}
                  </>
                }
                meta={m.email}
                aside={
                  <>
                    <span className="meta">{m.role === "owner" ? "Owner" : "Member"}</span>
                    {role === "owner" && m.id !== user.id && (
                      <ActionButton action={removeMemberAction} fields={{ userId: m.id }} className="btn-xs" confirm="Remove?" aria-label={`Remove ${m.email}`}>
                        Remove
                      </ActionButton>
                    )}
                  </>
                }
              />
            ))}
            {pending.map((i) => (
              <ListRow
                key={i.id}
                title={<span className="font-normal">{i.email}</span>}
                meta={`Invited ${timeAgo(i.createdAt)}`}
                aside={
                  role === "owner" && (
                    <ActionButton action={cancelInviteAction} fields={{ inviteId: i.id }} className="btn-xs" confirm="Cancel it?">
                      Cancel invite
                    </ActionButton>
                  )
                }
              />
            ))}
          </List>
          {role === "owner" && (
            <ActionForm action={inviteAction}>
              <InlineAdd id="invite" label="Email" button="Invite someone">
                <input id="invite" name="email" type="email" required className="field min-w-0 flex-1" placeholder="teammate@example.com" />
              </InlineAdd>
            </ActionForm>
          )}
          <p className="hint m-0">
            {plural(members.length, "person", "people")} on {team.name}.
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}

function TextField({ name, label, hint, placeholder, defaultValue, type = "text", mono }: { name: string; label: string; hint?: string; placeholder?: string; defaultValue?: string; type?: string; mono?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} className={cx("field", mono && "font-mono text-sm")} autoComplete="off" />
    </Field>
  );
}

function IntegrationRow({ kind, title, row, status, children }: { kind: Integration["kind"]; title: string; row?: Integration; status: (r: Integration) => string; children: React.ReactNode }) {
  return (
    <li>
      <details className="group/int">
        <summary className="row cursor-pointer transition-colors hover:bg-sub">
          <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
            <span className="text-body font-medium">{title}</span>
            <span className="meta">{row ? (row.enabled ? status(row) : `Paused · ${status(row)}`) : "Not connected"}</span>
          </span>
          <span className="flex items-center gap-2">
            {row && !row.enabled && <Pill tone="warn">Paused</Pill>}
            <span className="btn btn-sm">
              {row ? "Manage" : "Connect"}
              <ChevronIcon className="transition-transform group-open/int:rotate-180" />
            </span>
          </span>
        </summary>
        <div className="flex flex-col gap-4 px-5 pb-5">
          <ActionForm action={saveIntegrationAction}>
            <Hidden fields={{ kind }} />
            {children}
            <SubmitButton className="btn-sm btn-primary w-fit" pendingText="Saving…">
              Save
            </SubmitButton>
          </ActionForm>
          {row && (
            <div className="flex gap-2 border-t border-divide pt-4">
              <ActionButton action={setIntegrationEnabledAction} fields={{ kind, enabled: row.enabled ? "0" : "1" }} className="btn-xs">
                {row.enabled ? "Pause alerts" : "Resume alerts"}
              </ActionButton>
              <ActionButton action={removeIntegrationAction} fields={{ kind }} className="btn-xs" confirm="Disconnect?">
                Disconnect
              </ActionButton>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
