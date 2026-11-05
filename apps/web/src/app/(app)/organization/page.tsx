import { db, domains, integrations, invitation, member, testWallets, user as users } from "@dappdrill/db";
import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { cancelInviteAction, inviteAction, removeMemberAction, renameOrgAction } from "@/actions/organization";
import {
  addDomainAction,
  createInboxAction,
  removeDomainAction,
  removeInboxAction,
  removeIntegrationAction,
  saveIntegrationAction,
  setIntegrationEnabledAction,
  verifyDomainAction,
} from "@/actions/org-settings";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { DeleteOrg, LeaveOrg } from "@/components/org/leave-delete";
import { RoleSelect } from "@/components/org/role-select";
import { Addr, cx, List, PageHeader, SettingsSection, Tag } from "@/components/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { env } from "@/lib/env";
import { plural, timeAgo } from "@/lib/format";
import { can, canManageMember, grantable, ROLE_LABEL, toRole } from "@/lib/permissions";
import { currentOrg, orgApps } from "@/lib/session";

export const metadata: Metadata = { title: "Organization" };

type Integration = typeof integrations.$inferSelect;

const DAY = 24 * 60 * 60 * 1000;

export default async function OrganizationPage() {
  const { user, org, role } = await currentOrg();
  const apps = await orgApps(org.id);
  const [[wallets], domainRows, integrationRows, members, pending] = await Promise.all([
    db().select().from(testWallets).where(eq(testWallets.organizationId, org.id)),
    db().select().from(domains).where(eq(domains.organizationId, org.id)).orderBy(asc(domains.createdAt)),
    db().select().from(integrations).where(eq(integrations.organizationId, org.id)),
    db()
      .select({ id: member.id, userId: users.id, name: users.name, email: users.email, role: member.role })
      .from(member)
      .innerJoin(users, eq(users.id, member.userId))
      .where(eq(member.organizationId, org.id))
      .orderBy(asc(member.createdAt)),
    db()
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, org.id), eq(invitation.status, "pending")))
      .orderBy(asc(invitation.createdAt)),
  ]);
  const integ = new Map(integrationRows.map((i) => [i.kind, i]));
  const manage = can(role, "org.manage");
  const manageMembers = can(role, "members.manage");
  const roles = grantable(role);
  const now = Date.now();
  // Every form names its organization, so a tab left open on another one can't change this one.
  const orgField = <input type="hidden" name="orgId" value={org.id} />;

  return (
    <div className="page flex flex-col">
      <PageHeader
        title={org.name}
        description={`${user.name || user.email} · ${ROLE_LABEL[role]}${manage ? "" : " · Admins and owners can change these settings"}`}
      />

      {manage && (
        <SettingsSection id="general" title="Name" hint="Shown in the switcher and in invites.">
          <ActionForm action={renameOrgAction}>
            {orgField}
            <div className="flex gap-2">
              <label htmlFor="org-name" className="sr-only">
                Organization name
              </label>
              <Input id="org-name" name="name" required maxLength={60} defaultValue={org.name} className="min-w-0 flex-1" autoComplete="off" />
              <Button type="submit" variant="outline">
                Save
              </Button>
            </div>
          </ActionForm>
        </SettingsSection>
      )}

      <SettingsSection id="members" title="Members" hint="Everyone can add apps and run and edit tests. Admins also change settings and invite people. Owners can also delete the organization.">
        <List>
          {members.map((m) => {
            const theirs = toRole(m.role);
            const editable = m.userId !== user.id && canManageMember(role, theirs);
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    {m.name || m.email}
                    {m.userId === user.id && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">{m.email}</span>
                </span>
                {editable ? (
                  <span className="flex items-start gap-2">
                    <RoleSelect orgId={org.id} memberId={m.id} role={theirs} options={roles} label={`Role of ${m.email}`} />
                    <form action={removeMemberAction}>
                      {orgField}
                      <input type="hidden" name="memberId" value={m.id} />
                      <Button type="submit" variant="outline" size="sm" aria-label={`Remove ${m.email}`}>
                        Remove
                      </Button>
                    </form>
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">{ROLE_LABEL[theirs]}</span>
                )}
              </li>
            );
          })}
          {pending.map((i) => {
            const left = Math.ceil((i.expiresAt.getTime() - now) / DAY);
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{i.email}</span>
                  <span className="text-sm text-muted-foreground">
                    Invited as {ROLE_LABEL[toRole(i.role)].toLowerCase()} {timeAgo(i.createdAt)} · {left > 0 ? `expires in ${plural(left, "day")}` : "expired"}
                  </span>
                </span>
                {manageMembers && (
                  <span className="flex items-center gap-2">
                    {left > 0 && <CopyButton text={`${env.appUrl}/invite/${i.id}`} label="Copy link" size="xs" />}
                    <form action={cancelInviteAction}>
                      <input type="hidden" name="invitationId" value={i.id} />
                      <Button type="submit" variant="outline" size="xs" aria-label={`Cancel the invite for ${i.email}`}>
                        Cancel invite
                      </Button>
                    </form>
                  </span>
                )}
              </li>
            );
          })}
        </List>
        {manageMembers && (
          <ActionForm action={inviteAction}>
            {orgField}
            <div className="flex flex-wrap gap-2">
              <label htmlFor="invite" className="sr-only">
                Email
              </label>
              <Input id="invite" name="email" type="email" required className="min-w-40 flex-1" placeholder="teammate@example.com" autoComplete="off" />
              <NativeSelect name="role" defaultValue="member" aria-label="Role">
                {roles.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button type="submit" variant="outline">
                Invite
              </Button>
            </div>
          </ActionForm>
        )}
        <p className="text-sm text-muted-foreground">
          {plural(members.length, "person", "people")} in {org.name}.
        </p>
      </SettingsSection>

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
            {!manage ? null : wallets?.inboxAddress ? (
              <form action={removeInboxAction}>
                {orgField}
                <Button type="submit" variant="outline" size="xs">
                  Remove
                </Button>
              </form>
            ) : (
              <ActionForm action={createInboxAction} className="items-end">
                {orgField}
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
                    {manage && (
                      <form action={removeDomainAction}>
                        {orgField}
                        <input type="hidden" name="domainId" value={d.id} />
                        <Button type="submit" variant="outline" size="xs" aria-label={`Remove ${d.host}`}>
                          Remove
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
                {!d.verifiedAt && manage && (
                  <div className="flex flex-col gap-2 text-sm">
                    <span>Do one of these, then press Verify:</span>
                    <span>
                      Serve <code className="font-mono">https://{d.host}/.well-known/dappdrill.txt</code> containing <code className="font-mono">{d.token}</code>
                    </span>
                    <span>
                      Or add a DNS TXT record on <code className="font-mono">{d.host}</code>: <code className="font-mono">dappdrill-verify={d.token}</code>
                    </span>
                    <ActionForm action={verifyDomainAction}>
                      {orgField}
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
        {!manage && domainRows.length === 0 && <p className="text-sm text-muted-foreground">No domains yet.</p>}
        {manage && (
        <ActionForm action={addDomainAction}>
          {orgField}
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
        )}
        {env.dev && <p className="text-sm text-muted-foreground">In dev mode, localhost counts as verified.</p>}
      </SettingsSection>

      <SettingsSection id="integrations" title="Integrations" hint="Where alerts go when a test stops passing.">
        <List>
          <IntegrationRow orgId={manage ? org.id : null} kind="slack" title="Slack" row={integ.get("slack")} status={(r) => `Alerts to ${r.config.channel ?? "your webhook"}`}>
            <Field name="secret" label="Incoming Webhook URL" placeholder={integ.get("slack") ? "Saved. Paste a new one to replace it." : "https://hooks.slack.com/services/…"} type="password" mono />
            <Field name="channel" label="Channel name (for your reference)" placeholder="#qa" defaultValue={integ.get("slack")?.config.channel} />
          </IntegrationRow>
          <IntegrationRow orgId={manage ? org.id : null} kind="telegram" title="Telegram" row={integ.get("telegram")} status={(r) => `Alerts to chat ${r.config.chatId}`}>
            <Field name="secret" label="Bot token" placeholder={integ.get("telegram") ? "Saved. Paste a new one to replace it." : "123456:ABC…"} type="password" mono />
            <Field name="chatId" label="Chat id" placeholder="-1001234567890" defaultValue={integ.get("telegram")?.config.chatId} mono />
          </IntegrationRow>
          <IntegrationRow orgId={manage ? org.id : null} kind="email" title="Email" row={integ.get("email")} status={(r) => `Alerts to ${r.config.to}`}>
            <Field name="to" label="Send alerts to" placeholder="qa@example.com, dev@example.com" defaultValue={integ.get("email")?.config.to} />
          </IntegrationRow>
        </List>
      </SettingsSection>

      <SettingsSection
        id="leave"
        title={can(role, "org.delete") ? "Leave or delete" : "Leave"}
        hint={can(role, "org.delete") ? "Deleting removes every app, test and run in the organization." : "You lose access to this organization's apps and tests."}
      >
        <div className="flex flex-wrap gap-2">
          <LeaveOrg orgId={org.id} name={org.name} />
          {can(role, "org.delete") && <DeleteOrg orgId={org.id} name={org.name} losing={apps.length ? `${plural(apps.length, "app")}, with every test and run,` : "the organization"} />}
        </div>
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

/** `orgId` is null for people who can only look. */
function IntegrationRow({ orgId, kind, title, row, status, children }: { orgId: string | null; kind: Integration["kind"]; title: string; row?: Integration; status: (r: Integration) => string; children: React.ReactNode }) {
  const state = row ? (row.enabled ? status(row) : `Paused · ${status(row)}`) : "Not connected";
  if (!orgId) return <Row title={title} detail={state} />;
  const orgField = <input type="hidden" name="orgId" value={orgId} />;
  return (
    <li className="px-5 py-4">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-sm text-muted-foreground">{state}</span>
          </span>
          <span className={buttonVariants({ variant: "outline", size: "sm" })}>{row ? "Manage" : "Connect"}</span>
        </summary>
        <div className="mt-4 flex flex-col gap-3">
          <ActionForm action={saveIntegrationAction}>
            {orgField}
            <input type="hidden" name="kind" value={kind} />
            {children}
            <Button type="submit" size="sm" className="w-fit">
              Save
            </Button>
          </ActionForm>
          {row && (
            <div className="flex gap-2">
              <form action={setIntegrationEnabledAction}>
                {orgField}
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="enabled" value={row.enabled ? "0" : "1"} />
                <Button type="submit" variant="outline" size="xs">
                  {row.enabled ? "Pause" : "Resume"}
                </Button>
              </form>
              <form action={removeIntegrationAction}>
                {orgField}
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
