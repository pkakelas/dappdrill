import { db, invitation, organization, user as users } from "@dappdrill/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { acceptInviteAction } from "@/actions/organization";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABEL, toRole } from "@/lib/permissions";
import { getSession, isMember } from "@/lib/session";

export const metadata: Metadata = { title: "Join an organization" };

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/">Go to DappDrill</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db()
    .select({ invite: invitation, org: organization.name, inviter: users.name })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(users, eq(users.id, invitation.inviterId))
    .where(eq(invitation.id, id));

  const session = await getSession();
  const mine = row && session?.user.email.toLowerCase() === row.invite.email.toLowerCase();
  if (row && session && mine && (await isMember(session.user.id, row.invite.organizationId))) {
    return <Notice title={`You're already in ${row.org}`}>There&apos;s nothing left to accept.</Notice>;
  }
  if (!row || row.invite.status !== "pending") {
    return <Notice title="This invite isn't valid">It was already used or cancelled. Ask whoever invited you for a new one.</Notice>;
  }
  const from = row.inviter || "whoever invited you";
  if (row.invite.expiresAt < new Date()) {
    return <Notice title="This invite has expired">Invites last a week. Ask {from} to send a new one.</Notice>;
  }

  const here = `/invite/${id}`;
  const next = encodeURIComponent(here);
  const role = ROLE_LABEL[toRole(row.invite.role)].toLowerCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Join {row.org}</CardTitle>
        <CardDescription>
          {row.inviter ? `${row.inviter} invited ${row.invite.email}` : `This invite is for ${row.invite.email}`} to test dApps together on DappDrill, as {role === "member" ? "a member" : `an ${role}`}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!session ? (
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link href={`/signup?next=${next}`}>Create an account</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/login?next=${next}`}>I already have one</Link>
            </Button>
            <span className="text-sm text-muted-foreground">Use {row.invite.email}. The invite only works for that address.</span>
          </div>
        ) : !mine ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              You&apos;re signed in as {session.user.email}, and this invite only works for {row.invite.email}.
            </p>
            <SignOutButton next={`/login?next=${next}`}>Sign in with another account</SignOutButton>
          </div>
        ) : (
          <ActionForm action={acceptInviteAction}>
            <input type="hidden" name="invitationId" value={id} />
            <Button type="submit">Join {row.org}</Button>
            <span className="text-sm text-muted-foreground">Signed in as {session.user.email}.</span>
          </ActionForm>
        )}
      </CardContent>
    </Card>
  );
}
