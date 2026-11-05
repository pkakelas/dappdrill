import "server-only";
import { apps, db, member, organization } from "@dappdrill/db";
import { and, asc, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { can, denied, toRole, type Permission, type Role } from "./permissions";

/** The organization picked last. A cookie, so it survives signing out and back in. */
export const ORG_COOKIE = "dd_org";
const YEAR = 60 * 60 * 24 * 365;

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s.user;
}

export type Org = typeof organization.$inferSelect;
export type Membership = { org: Org; role: Role; memberId: string };

export const memberships = cache(async (userId: string): Promise<Membership[]> => {
  const rows = await db()
    .select({ org: organization, role: member.role, memberId: member.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
  return rows.map((r) => ({ ...r, role: toRole(r.role) }));
});

/** The organization the user is working in: the one picked last (cookie), else their first. */
export const currentOrg = cache(async () => {
  const user = await requireUser();
  const all = await memberships(user.id);
  // Left or deleted their last one: nothing to show until they make another (or accept an invite).
  if (all.length === 0) redirect("/organizations/new");
  const picked = (await cookies()).get(ORG_COOKIE)?.value;
  const m = all.find((x) => x.org.id === picked) ?? all[0]!;
  return { user, ...m, all };
});

/** For server actions and route handlers only (pages can't set cookies). */
export async function rememberOrg(orgId: string): Promise<void> {
  (await cookies()).set(ORG_COOKIE, orgId, { path: "/", maxAge: YEAR, sameSite: "lax" });
}

/**
 * For server actions: the organization the form names, if the user is in it and may do this.
 * Forms name their organization instead of leaning on the cookie, so a second tab on another
 * organization can't send a change to the wrong one.
 */
export async function orgAccess(orgId: unknown, permission?: Permission) {
  const user = await requireUser();
  const m = (await memberships(user.id)).find((x) => x.org.id === orgId);
  if (!m) return { error: "You're not in that organization any more. Reload the page." };
  if (permission && !can(m.role, permission)) return { error: denied(permission) };
  return { user, ...m };
}

export type App = typeof apps.$inferSelect;

/** Loads an app the signed-in user can see (with their role in its organization), or 404s. */
export const requireApp = cache(async (appId: string) => {
  const user = await requireUser();
  const [row] = await db()
    .select({ app: apps, role: member.role })
    .from(apps)
    .innerJoin(member, and(eq(member.organizationId, apps.organizationId), eq(member.userId, user.id)))
    .where(eq(apps.id, appId));
  if (!row) notFound();
  return { user, app: row.app, role: toRole(row.role) };
});

export async function orgApps(orgId: string): Promise<App[]> {
  return db().select().from(apps).where(eq(apps.organizationId, orgId)).orderBy(asc(apps.createdAt));
}

/** True when the user belongs to the organization. */
export async function isMember(userId: string, orgId: string): Promise<boolean> {
  const all = await memberships(userId);
  return all.some((m) => m.org.id === orgId);
}
