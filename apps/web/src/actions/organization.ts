"use server";

import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { MAX_OWNED, provisionOrganization } from "@/lib/organizations";
import { denied, grantable, ROLES } from "@/lib/permissions";
import { memberships, ORG_COOKIE, orgAccess, rememberOrg, requireUser } from "@/lib/session";

// Membership goes through Better Auth's organization plugin, which enforces the rules itself
// (who may invite, admins can't touch owners, an organization keeps an owner). The checks here
// come first only to say something clearer.

const Id = z.string().min(1).max(100);
const Name = z.string().trim().min(1, "Give it a name.").max(60, "Keep the name under 60 characters.");
const RoleIn = z.enum(ROLES);

const SAID: Record<string, string> = {
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: "You're the only owner. Make someone else an owner first, or delete the organization.",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: "An organization needs at least one owner.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "They're already in this organization.",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: "This invite is for a different email address.",
  INVITATION_NOT_FOUND: "This invite was used, cancelled or has expired.",
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: "This organization is full.",
  INVITATION_LIMIT_REACHED: "Too many invites are waiting. Cancel some first.",
};

/** Runs a plugin call; what it refuses comes back as a line for the form. */
async function ask<T>(call: () => Promise<T>): Promise<{ data: T } | { error: string }> {
  try {
    return { data: await call() };
  } catch (e) {
    if (!(e instanceof APIError)) throw e;
    const code = (e.body as { code?: string } | undefined)?.code;
    return { error: (code && SAID[code]) || e.message || "That didn't work. Try again." };
  }
}

async function forgetOrg(): Promise<void> {
  const jar = await cookies();
  jar.delete(ORG_COOKIE);
  jar.delete("dd_app");
}

// ---------------------------------------------------------------- which organization

/** The switcher: work in another organization, starting from its apps. */
export async function switchOrgAction(orgId: string): Promise<void> {
  const a = await orgAccess(orgId);
  if ("error" in a) return;
  await rememberOrg(a.org.id);
  (await cookies()).delete("dd_app");
  redirect("/");
}

/** A link opened an app in another of the user's organizations: follow it there, staying on the page. */
export async function followOrgAction(orgId: string): Promise<void> {
  const a = await orgAccess(orgId);
  if (!("error" in a)) await rememberOrg(a.org.id);
}

// ---------------------------------------------------------------- the organization

export async function createOrgAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const name = Name.safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0]?.message };
  const owned = (await memberships(user.id)).filter((m) => m.role === "owner").length;
  if (owned >= MAX_OWNED) return { error: `You can own up to ${MAX_OWNED} organizations.` };
  const id = await provisionOrganization(user.id, name.data);
  await rememberOrg(id);
  (await cookies()).delete("dd_app");
  revalidatePath("/", "layout");
  redirect("/");
}

export async function renameOrgAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await orgAccess(form.get("orgId"), "org.manage");
  if ("error" in a) return a;
  const name = Name.safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0]?.message };
  const res = await ask(async () => auth.api.updateOrganization({ body: { organizationId: a.org.id, data: { name: name.data } }, headers: await headers() }));
  if ("error" in res) return res;
  revalidatePath("/", "layout"); // the name shows in the switcher
  return { ok: "Saved." };
}

/** Deletes the organization with its apps, tests and runs. The form asks for its name first. */
export async function deleteOrgAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await orgAccess(form.get("orgId"), "org.delete");
  if ("error" in a) return a;
  if (String(form.get("confirm") ?? "").trim() !== a.org.name.trim()) return { error: "That isn't the organization's name." };
  const res = await ask(async () => auth.api.deleteOrganization({ body: { organizationId: a.org.id }, headers: await headers() }));
  if ("error" in res) return res;
  await forgetOrg();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function leaveOrgAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await orgAccess(form.get("orgId"));
  if ("error" in a) return a;
  const res = await ask(async () => auth.api.leaveOrganization({ body: { organizationId: a.org.id }, headers: await headers() }));
  if ("error" in res) return res;
  await forgetOrg();
  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------- invites

export async function inviteAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await orgAccess(form.get("orgId"), "members.manage");
  if ("error" in a) return a;
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter an email address." };
  const role = RoleIn.safeParse(form.get("role") ?? "member");
  if (!role.success) return { error: "Choose a role." };
  if (!grantable(a.role).includes(role.data)) return { error: denied("owners.manage") };
  const res = await ask(async () => auth.api.createInvitation({ body: { email: email.data, role: role.data, organizationId: a.org.id }, headers: await headers() }));
  if ("error" in res) return res;
  revalidatePath("/organization");
  return { ok: `Invite sent to ${email.data}. You can also share the link, which only they can use:`, secret: `${env.appUrl}/invite/${res.data.id}` };
}

export async function cancelInviteAction(invitationId: string): Promise<{ error?: string }> {
  await requireUser();
  const res = await ask(async () => auth.api.cancelInvitation({ body: { invitationId: Id.parse(invitationId) }, headers: await headers() }));
  revalidatePath("/organization");
  return "error" in res ? res : {};
}

/** Joins the invite's organization. The plugin checks it is still open and meant for this email. */
export async function acceptInviteAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const invitationId = Id.parse(form.get("invitationId"));
  const res = await ask(async () => auth.api.acceptInvitation({ body: { invitationId }, headers: await headers() }));
  if ("error" in res) return res;
  if (res.data?.invitation) await rememberOrg(res.data.invitation.organizationId);
  (await cookies()).delete("dd_app");
  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------- members

export async function removeMemberAction(orgId: string, memberId: string): Promise<{ error?: string }> {
  const a = await orgAccess(orgId, "members.manage");
  if ("error" in a) return a;
  const res = await ask(async () => auth.api.removeMember({ body: { memberIdOrEmail: Id.parse(memberId), organizationId: a.org.id }, headers: await headers() }));
  revalidatePath("/organization");
  return "error" in res ? res : {};
}

export async function setMemberRoleAction(orgId: string, memberId: string, role: string): Promise<{ error?: string }> {
  const a = await orgAccess(orgId, "members.manage");
  if ("error" in a) return a;
  const to = RoleIn.safeParse(role);
  if (!to.success) return { error: "Choose a role." };
  if (!grantable(a.role).includes(to.data)) return { error: denied("owners.manage") };
  const res = await ask(async () => auth.api.updateMemberRole({ body: { memberId: Id.parse(memberId), role: to.data, organizationId: a.org.id }, headers: await headers() }));
  revalidatePath("/organization");
  return "error" in res ? res : {};
}
