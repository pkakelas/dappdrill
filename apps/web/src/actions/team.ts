"use server";

import { db, invites, teamMembers } from "@dappdrill/db";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isMember, requireUser, TEAM_COOKIE } from "@/lib/session";

export async function switchTeam(teamId: string): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(teamId);
  if (!(await isMember(user.id, id))) return;
  const jar = await cookies();
  jar.set(TEAM_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  jar.delete("dd_app");
  redirect("/");
}

/** Joins the invite's team (link invites: anyone signed in with the link can accept once). */
export async function acceptInviteAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const token = z.string().min(16).max(100).parse(form.get("token"));
  const [invite] = await db().select().from(invites).where(and(eq(invites.token, token), isNull(invites.acceptedAt)));
  if (!invite) redirect(`/invite/${token}`);
  await db().transaction(async (tx) => {
    await tx.insert(teamMembers).values({ teamId: invite.teamId, userId: user.id, role: "member" }).onConflictDoNothing();
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
  });
  const jar = await cookies();
  jar.set(TEAM_COOKIE, invite.teamId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  jar.delete("dd_app");
  redirect("/");
}
