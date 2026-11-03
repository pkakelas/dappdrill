import "server-only";
import { apps, db, teamMembers, teams } from "@dappdrill/db";
import { and, asc, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

export const TEAM_COOKIE = "dd_team";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s.user;
}

export type Team = typeof teams.$inferSelect;
export type Membership = { team: Team; role: "owner" | "member" };

export const memberships = cache(async (userId: string): Promise<Membership[]> => {
  const rows = await db()
    .select({ team: teams, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teamMembers.createdAt));
  return rows;
});

/** The team the user is working in: the one picked last (cookie), else their first. */
export const currentTeam = cache(async () => {
  const user = await requireUser();
  const all = await memberships(user.id);
  if (all.length === 0) throw new Error(`user ${user.id} has no team`);
  const picked = (await cookies()).get(TEAM_COOKIE)?.value;
  const m = all.find((x) => x.team.id === picked) ?? all[0]!;
  return { user, team: m.team, role: m.role, all };
});

export type App = typeof apps.$inferSelect;

/** Loads an app the signed-in user can see, or 404s. */
export const requireApp = cache(async (appId: string) => {
  const user = await requireUser();
  const [row] = await db()
    .select({ app: apps, role: teamMembers.role })
    .from(apps)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, apps.teamId), eq(teamMembers.userId, user.id)))
    .where(eq(apps.id, appId));
  if (!row) notFound();
  return { user, app: row.app, role: row.role };
});

export async function teamApps(teamId: string): Promise<App[]> {
  return db().select().from(apps).where(eq(apps.teamId, teamId)).orderBy(asc(apps.createdAt));
}

/** For server actions: true when the user belongs to the team. */
export async function isMember(userId: string, teamId: string): Promise<boolean> {
  const all = await memberships(userId);
  return all.some((m) => m.team.id === teamId);
}
