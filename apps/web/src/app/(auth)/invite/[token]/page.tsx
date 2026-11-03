import { db, invites, teams, user as users } from "@dappdrill/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { acceptInviteAction } from "@/actions/team";
import { AuthCard } from "@/components/auth/auth-card";
import { Hidden, SubmitButton } from "@/components/ui";
import { getSession, isMember } from "@/lib/session";

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
      <AuthCard title="This invite isn't valid" sub="It was already used or cancelled. Ask whoever invited you for a new link.">
        <Link href="/" className="btn w-fit">
          Go to DappDrill
        </Link>
      </AuthCard>
    );
  }

  const session = await getSession();
  const next = encodeURIComponent(`/invite/${token}`);
  const already = session ? await isMember(session.user.id, row.invite.teamId) : false;

  return (
    <AuthCard
      title={`Join ${row.teamName}`}
      sub={`${row.inviter ? `${row.inviter} invited ${row.invite.email}` : `This invite is for ${row.invite.email}`} to test dApps together on DappDrill.`}
    >
      {!session ? (
        <div className="flex flex-col gap-2">
          <Link href={`/signup?next=${next}`} className="btn btn-primary btn-lg">
            Create an account
          </Link>
          <Link href={`/login?next=${next}`} className="btn btn-lg">
            I already have one
          </Link>
        </div>
      ) : already ? (
        <Link href="/" className="btn btn-primary btn-lg">
          Go to {row.teamName}
        </Link>
      ) : (
        <form action={acceptInviteAction} className="flex flex-col gap-2">
          <Hidden fields={{ token }} />
          <SubmitButton className="btn-primary btn-lg" pendingText="Joining…">
            Join {row.teamName}
          </SubmitButton>
          <span className="hint text-center">Signed in as {session.user.email}.</span>
        </form>
      )}
      {already && <p className="hint m-0">You&apos;re already in this team.</p>}
    </AuthCard>
  );
}
