import { db, invites, teams, user as users } from "@dappdrill/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { acceptInviteAction } from "@/actions/team";
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
      <div className="card flex flex-col gap-3 p-6">
        <h1 className="m-0 font-serif text-[32px] leading-tight font-[380] tracking-[-0.02em]">This invite isn&apos;t valid</h1>
        <p className="m-0 text-sm text-muted">It was already used or cancelled. Ask whoever invited you for a new link.</p>
        <Link href="/" className="btn w-fit">
          Go to DappDrill
        </Link>
      </div>
    );
  }

  const session = await getSession();
  const next = encodeURIComponent(`/invite/${token}`);
  const already = session ? await isMember(session.user.id, row.invite.teamId) : false;

  return (
    <div className="card flex flex-col gap-4 p-6">
      <h1 className="m-0 font-serif text-[32px] leading-tight font-[380] tracking-[-0.02em]">Join {row.teamName}</h1>
      <p className="m-0 text-sm text-ink-2">
        {row.inviter ? `${row.inviter} invited ${row.invite.email}` : `This invite is for ${row.invite.email}`} to test dApps together on DappDrill.
      </p>
      {!session ? (
        <div className="flex flex-col gap-2">
          <Link href={`/signup?next=${next}`} className="btn btn-primary">
            Create an account
          </Link>
          <Link href={`/login?next=${next}`} className="btn">
            I already have one
          </Link>
        </div>
      ) : already ? (
        <Link href="/" className="btn btn-primary">
          You&apos;re already in this team
        </Link>
      ) : (
        <form action={acceptInviteAction} className="flex flex-col gap-2">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary">
            Join {row.teamName}
          </button>
          <span className="hint">Signed in as {session.user.email}.</span>
        </form>
      )}
    </div>
  );
}
