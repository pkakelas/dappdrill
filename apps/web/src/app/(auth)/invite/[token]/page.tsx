import { db, invites, teams, user as users } from "@dappdrill/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { acceptInviteAction } from "@/actions/team";
import { getSession, isMember } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Join a team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [row] = await db()
    .select({ invite: invites, teamName: teams.name, inviter: users.name })
    .from(invites)
    .innerJoin(teams, eq(teams.id, invites.teamId))
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(eq(invites.token, token));

  if (!row || row.invite.acceptedAt) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">This invite isn&apos;t valid</CardTitle>
          <CardDescription>It was already used or cancelled. Ask whoever invited you for a new link.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/">Go to DappDrill</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const session = await getSession();
  const next = encodeURIComponent(`/invite/${token}`);
  const already = session ? await isMember(session.user.id, row.invite.teamId) : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Join {row.teamName}</CardTitle>
        <CardDescription>
          {row.inviter ? `${row.inviter} invited ${row.invite.email}` : `This invite is for ${row.invite.email}`} to test dApps together on DappDrill.
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
          </div>
        ) : already ? (
          <Button asChild className="w-full">
            <Link href="/">You&apos;re already in this team</Link>
          </Button>
        ) : (
          <form action={acceptInviteAction} className="flex flex-col gap-2">
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Join {row.teamName}</Button>
            <span className="text-muted-foreground">Signed in as {session.user.email}.</span>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
