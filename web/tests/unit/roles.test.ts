import { describe, expect, it } from "vitest";
import {
  assertNotLastOwner,
  assignableRoles,
  canManageMembership,
  RoleRuleError,
} from "@/server/organisations/roles";

// AUTH03 role-assignment rules.

describe("assignableRoles", () => {
  it("lets an owner give every organisation role, owner included", () => {
    expect(assignableRoles(["owner"])).toEqual([
      "owner",
      "admin",
      "coach",
      "scout",
      "agent",
      "player",
      "guardian",
    ]);
  });

  it("lets an admin give every organisation role except owner", () => {
    expect(assignableRoles(["admin"])).toEqual([
      "admin",
      "coach",
      "scout",
      "agent",
      "player",
      "guardian",
    ]);
  });

  it("gives a coach nothing, and never offers platform_admin", () => {
    expect(assignableRoles(["coach"])).toEqual([]);
    expect(assignableRoles(["platform_admin"])).toEqual([]);
    expect(assignableRoles(["owner", "admin", "platform_admin"])).not.toContain("platform_admin");
  });
});

describe("canManageMembership", () => {
  it("lets an owner manage anyone but a platform admin", () => {
    expect(canManageMembership(["owner"], "owner")).toBe(true);
    expect(canManageMembership(["owner"], "coach")).toBe(true);
    expect(canManageMembership(["owner"], "platform_admin")).toBe(false);
  });

  it("stops an admin from changing or removing an owner", () => {
    expect(canManageMembership(["admin"], "owner")).toBe(false);
    expect(canManageMembership(["admin"], "admin")).toBe(true);
    expect(canManageMembership(["admin"], "guardian")).toBe(true);
  });

  it("gives other roles no management", () => {
    expect(canManageMembership(["coach"], "player")).toBe(false);
    expect(canManageMembership(["platform_admin"], "coach")).toBe(false);
  });
});

describe("assertNotLastOwner", () => {
  it("blocks removing or demoting the last owner", () => {
    expect(() => assertNotLastOwner({ targetRole: "owner", ownerCount: 1 })).toThrow(RoleRuleError);
    expect(() =>
      assertNotLastOwner({ targetRole: "owner", ownerCount: 1, newRole: "admin" }),
    ).toThrow(RoleRuleError);
  });

  it("allows it when another owner remains, or when the role stays owner", () => {
    expect(() => assertNotLastOwner({ targetRole: "owner", ownerCount: 2 })).not.toThrow();
    expect(() =>
      assertNotLastOwner({ targetRole: "owner", ownerCount: 1, newRole: "owner" }),
    ).not.toThrow();
    expect(() => assertNotLastOwner({ targetRole: "coach", ownerCount: 0 })).not.toThrow();
  });
});
