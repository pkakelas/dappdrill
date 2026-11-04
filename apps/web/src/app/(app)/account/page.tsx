import { db, domains, integrations, invites, teamMembers, testWallets, user as users } from "@dappdrill/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import {
  addDomainAction,
  cancelInviteAction,
  createInboxAction,
  inviteAction,
  removeDomainAction,
  removeInboxAction,
  removeIntegrationAction,
  removeMemberAction,
  saveIntegrationAction,
  setIntegrationEnabledAction,
  verifyDomainAction,
} from "@/actions/account";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Addr, cx, List, PageHeader, SettingsSection, Tag } from "@/components/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { env } from "@/lib/env";
import { plural, timeAgo } from "@/lib/format";
import { currentTeam, teamApps } from "@/lib/session";

export const metadata: Metadata = { title: "Account" };

type Integration = typeof integrations.$inferSelect;

export default async function AccountPage() {
  const { user, team, role } = await currentTeam();
  const apps = await teamApps(team.id);
  const [[wallets], domainRows, integrationRows, members, pending] = await Promise.all([
    db().select().from(testWallets).where(eq(testWallets.teamId, team.id)),
    db().select().from(domains).where(eq(domains.teamId, team.id)).orderBy(asc(domains.createdAt)),
    db().select().from(integrations).where(eq(integrations.teamId, team.id)),
    db()
      .select({ id: users.id, name: users.name, email: users.email, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, team.id))
      .orderBy(asc(teamMembers.createdAt)),
    db()
      .select()
      .from(invites)
      .where(and(eq(invites.teamId, team.id), isNull(invites.acceptedAt)))
      .orderBy(asc(invites.createdAt)),
  ]);
  const integ = new Map(integrationRows.map((i) => [i.kind, i]));

  return (
    <div className="page flex flex-col">
      <PageHeader title="Account" description={`${user.name || user.email} · ${role === "owner" ? "Owner" : "Member"} of ${team.name}`} />

      <SettingsSection id="wallets" title="Test wallets" hint="Created and funded on every fork. They never hold real funds.">
        <List>
          <Row title="Test account A" detail={<Addr value={wallets?.accountAAddress} chars={6} />} aside={wallets && <CopyButton text={wallets.accountAAddress} label="Copy" size="xs" />} />
          <Row
            title="Test account B"
            detail={
              <>
                <Addr value={wallets?.accountBAddress} chars={6} /> · used for account-switch tests
              </>
            }
            aside={wallets && <CopyButton text={wallets.accountBAddress} label="Copy" size="xs" />}
          />
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">Embedded wallet login</span>
              <span className="text-sm text-muted-foreground">
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
                <Button type="submit" variant="outline" size="xs">
                  Remove
                </Button>
              </form>
            ) : (
              <ActionForm action={createInboxAction} className="items-end">
                <Button type="submit" variant="outline" size="sm">
                  Create inbox
                </Button>
              </ActionForm>
            )}
          </li>
          {apps
            .filter((a) => a.liveKeyAddress)
            .map((a) => (
              <Row
                key={a.id}
                title={`Funded account · ${a.name}`}
                detail={<Addr value={a.liveKeyAddress} chars={6} />}
                aside={
                  <Button asChild variant="link" size="sm" className="h-auto p-0">
                    <Link href={`/apps/${a.id}/settings`}>Change</Link>
                  </Button>
                }
              />
            ))}
        </List>
        {apps[0] && (
          <p className="text-sm text-muted-foreground">
            Testing on a chain that can&apos;t be forked? Add a funded testnet key in the{" "}
            <Link href={`/apps/${apps[0].id}/settings`} className="underline underline-offset-4 hover:text-foreground">
              app&apos;s settings
            </Link>
            .
          </p>
        )}
      </SettingsSection>

      <SettingsSection id="domains" title="Domains" hint="Scheduled runs need a verified domain, so DappDrill only tests sites you own.">
        {domainRows.length > 0 && (
          <List>
            {domainRows.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-sm">{d.host}</span>
                  <div className="flex items-center gap-2">
                    {d.verifiedAt ? <Tag tone="quiet">Verified</Tag> : <Tag tone="warn">Not verified</Tag>}
                    <form action={removeDomainAction}>
                      <input type="hidden" name="domainId" value={d.id} />
                      <Button type="submit" variant="outline" size="xs" aria-label={`Remove ${d.host}`}>
                        Remove
                      </Button>
                    </form>
                  </div>
                </div>
                {!d.verifiedAt && (
                  <div className="flex flex-col gap-2 text-sm">
                    <span>Do one of these, then press Verify:</span>
                    <span>
                      Serve <code className="font-mono">https://{d.host}/.well-known/dappdrill.txt</code> containing <code className="font-mono">{d.token}</code>
                    </span>
                    <span>
                      Or add a DNS TXT record on <code className="font-mono">{d.host}</code>: <code className="font-mono">dappdrill-verify={d.token}</code>
                    </span>
                    <ActionForm action={verifyDomainAction}>
                      <input type="hidden" name="domainId" value={d.id} />
                      <Button type="submit" size="sm" className="w-fit">
                        Verify
                      </Button>
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
            <Input id="host" name="host" required className="min-w-0 flex-1 font-mono" placeholder="app.example.com" autoComplete="off" />
            <Button type="submit" variant="outline">
              Add a domain
            </Button>
          </div>
        </ActionForm>
        {env.dev && <p className="text-sm text-muted-foreground">In dev mode, localhost counts as verified.</p>}
      </SettingsSection>

      <SettingsSection id="integrations" title="Integrations" hint="Where alerts go when a test stops passing.">
        <List>
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

      <SettingsSection id="team" title="Team" hint="Everyone can run and edit tests. Owners invite and remove people.">
        <List>
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  {m.name || m.email}
                  {m.id === user.id && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <span className="text-sm text-muted-foreground">{m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{m.role === "owner" ? "Owner" : "Member"}</span>
                {role === "owner" && m.id !== user.id && (
                  <form action={removeMemberAction}>
                    <input type="hidden" name="userId" value={m.id} />
                    <Button type="submit" variant="outline" size="xs" aria-label={`Remove ${m.email}`}>
                      Remove
                    </Button>
                  </form>
                )}
              </span>
            </li>
          ))}
          {pending.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <span className="flex flex-col">
                <span className="text-sm">{i.email}</span>
                <span className="text-sm text-muted-foreground">Invited {timeAgo(i.createdAt)}</span>
              </span>
              {role === "owner" && (
                <form action={cancelInviteAction}>
                  <input type="hidden" name="inviteId" value={i.id} />
                  <Button type="submit" variant="outline" size="xs">
                    Cancel invite
                  </Button>
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
              <Input id="invite" name="email" type="email" required className="min-w-0 flex-1" placeholder="teammate@example.com" />
              <Button type="submit" variant="outline">
                Invite someone
              </Button>
            </div>
          </ActionForm>
        )}
        <p className="text-sm text-muted-foreground">
          {plural(members.length, "person", "people")} on {team.name}.
        </p>
      </SettingsSection>
    </div>
  );
}

function Row({ title, detail, aside }: { title: string; detail: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </span>
      {aside}
    </li>
  );
}

function Field({ name, label, placeholder, defaultValue, type = "text", mono }: { name: string; label: string; placeholder?: string; defaultValue?: string; type?: string; mono?: boolean }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm leading-none font-medium">{label}</span>
      <Input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} className={cx(mono && "font-mono")} autoComplete="off" />
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
            <span className="text-sm text-muted-foreground">{row ? (row.enabled ? status(row) : `Paused · ${status(row)}`) : "Not connected"}</span>
          </span>
          <span className={buttonVariants({ variant: "outline", size: "sm" })}>{row ? "Manage" : "Connect"}</span>
        </summary>
        <div className="mt-4 flex flex-col gap-3">
          <ActionForm action={saveIntegrationAction}>
            <input type="hidden" name="kind" value={kind} />
            {children}
            <Button type="submit" size="sm" className="w-fit">
              Save
            </Button>
          </ActionForm>
          {row && (
            <div className="flex gap-2">
              <form action={setIntegrationEnabledAction}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="enabled" value={row.enabled ? "0" : "1"} />
                <Button type="submit" variant="outline" size="xs">
                  {row.enabled ? "Pause" : "Resume"}
                </Button>
              </form>
              <form action={removeIntegrationAction}>
                <input type="hidden" name="kind" value={kind} />
                <Button type="submit" variant="outline" size="xs">
                  Disconnect
                </Button>
              </form>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
