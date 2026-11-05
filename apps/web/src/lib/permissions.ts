/**
 * Organization roles and what each may do. No IO: server actions enforce these and pages
 * use them to hide what wouldn't work.
 */
export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

/**
 * What takes more than being a member. Everything else (adding apps, running and editing
 * tests, the assistant) is open to everyone in the organization.
 */
const NEEDS = {
  /** An app's settings (URL, keys, access headers, schedule) and deleting it. */
  "apps.manage": "admin",
  /** The organization's name, domains, integrations and test inbox. */
  "org.manage": "admin",
  /** Inviting people, and removing or changing the role of anyone who isn't an owner. */
  "members.manage": "admin",
  /** Making, changing and removing owners. */
  "owners.manage": "owner",
  "org.delete": "owner",
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof NEEDS;

export function can(role: Role, permission: Permission): boolean {
  return RANK[role] >= RANK[NEEDS[permission]];
}

/** What to tell someone who may not. */
export function denied(permission: Permission): string {
  return NEEDS[permission] === "owner" ? "Only owners can do this." : "Only admins and owners can do this.";
}

/** The stored role as one of ours. Better Auth can store several ("admin,member"); the highest counts. */
export function toRole(stored: string): Role {
  const parts = stored.split(",").map((s) => s.trim());
  return ROLES.find((r) => parts.includes(r)) ?? "member";
}

/** The roles `actor` may hand out, in an invite or a role change. */
export function grantable(actor: Role): Role[] {
  if (can(actor, "owners.manage")) return [...ROLES];
  return can(actor, "members.manage") ? ["admin", "member"] : [];
}

/** Whether `actor` may remove `target` or change their role. Admins can't touch owners. */
export function canManageMember(actor: Role, target: Role): boolean {
  return can(actor, target === "owner" ? "owners.manage" : "members.manage");
}
