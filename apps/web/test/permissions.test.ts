import { describe, expect, it } from "vitest";
import { can, canManageMember, grantable, toRole } from "../src/lib/permissions";

describe("organization roles", () => {
  it("lets members work but not change settings or people", () => {
    for (const p of ["apps.manage", "org.manage", "members.manage", "owners.manage", "org.delete"] as const) expect(can("member", p)).toBe(false);
  });

  it("lets admins manage everything except owners and deletion", () => {
    expect(can("admin", "apps.manage")).toBe(true);
    expect(can("admin", "org.manage")).toBe(true);
    expect(can("admin", "members.manage")).toBe(true);
    expect(can("admin", "owners.manage")).toBe(false);
    expect(can("admin", "org.delete")).toBe(false);
  });

  it("lets owners do all of it", () => {
    expect(can("owner", "owners.manage")).toBe(true);
    expect(can("owner", "org.delete")).toBe(true);
  });

  it("keeps owners out of an admin's reach", () => {
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canManageMember("admin", "admin")).toBe(true);
    expect(canManageMember("owner", "owner")).toBe(true);
    expect(canManageMember("member", "member")).toBe(false);
  });

  it("only hands out roles up to the actor's own", () => {
    expect(grantable("owner")).toEqual(["owner", "admin", "member"]);
    expect(grantable("admin")).toEqual(["admin", "member"]);
    expect(grantable("member")).toEqual([]);
  });

  it("reads stored roles, taking the highest and falling back to member", () => {
    expect(toRole("owner")).toBe("owner");
    expect(toRole("member, admin")).toBe("admin");
    expect(toRole("something-else")).toBe("member");
  });
});
