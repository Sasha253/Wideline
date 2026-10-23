import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import type { AuthContext } from "@/server/auth/session";
import { changeMemberRole, listMembers, removeMembership } from "@/server/organisations/members";
import { RoleRuleError } from "@/server/organisations/roles";
import { SettingsError, updateOrganisationSettings } from "@/server/organisations/settings";
import { fixtures } from "./helpers/fixtures";

// AUTH03 role rules on memberships, and organisation settings.

const f = fixtures();
let org: { id: string };
let asOwner: AuthContext;
let asAdmin: AuthContext;
let ownerMembership: string;
let coachMembership: string;

beforeAll(async () => {
  org = await f.org("Members FC");
  const owner = await f.user("Olwethu Owner");
  const admin = await f.user("Ayanda Admin");
  const coach = await f.user("Chris Coach");
  ownerMembership = (await f.member(org.id, owner.id, "owner")).id;
  await f.member(org.id, admin.id, "admin");
  coachMembership = (await f.member(org.id, coach.id, "coach")).id;
  asOwner = await f.ctx(owner, org.id);
  asAdmin = await f.ctx(admin, org.id);
});

afterAll(async () => {
  await f.cleanup();
});

describe("members", () => {
  it("lists one row per membership, by name, with name and email only", async () => {
    const rows = await listMembers(asOwner);
    expect(rows.map((r) => [r.name, r.role])).toEqual([
      ["Ayanda Admin", "admin"],
      ["Chris Coach", "coach"],
      ["Olwethu Owner", "owner"],
    ]);
  });

  it("changing a role writes membership.role_changed with from and to", async () => {
    await changeMemberRole(asAdmin, coachMembership, "scout");
    const log = await rawDb.auditLog.findFirst({
      where: { action: "membership.role_changed", targetId: coachMembership },
    });
    expect(log?.metadata).toMatchObject({ from: "coach", to: "scout" });
    expect(log?.actorUserId).toBe(asAdmin.user.id);
  });

  it("an admin cannot demote or remove an owner, or make someone an owner", async () => {
    await expect(changeMemberRole(asAdmin, ownerMembership, "coach")).rejects.toMatchObject({
      code: "owner_only",
    });
    await expect(removeMembership(asAdmin, ownerMembership)).rejects.toMatchObject({
      code: "owner_only",
    });
    await expect(changeMemberRole(asAdmin, coachMembership, "owner")).rejects.toMatchObject({
      code: "not_assignable",
    });
    await expect(
      changeMemberRole(asOwner, coachMembership, "platform_admin"),
    ).rejects.toBeInstanceOf(RoleRuleError);
  });

  it("the last owner cannot be demoted or removed", async () => {
    await expect(changeMemberRole(asOwner, ownerMembership, "admin")).rejects.toMatchObject({
      code: "last_owner",
    });
    await expect(removeMembership(asOwner, ownerMembership)).rejects.toMatchObject({
      code: "last_owner",
    });
  });

  it("refuses a role the member already holds", async () => {
    await expect(changeMemberRole(asOwner, coachMembership, "scout")).rejects.toMatchObject({
      code: "same_role",
    });
  });

  it("removing a membership audits membership.removed", async () => {
    await removeMembership(asOwner, coachMembership);
    expect(await rawDb.membership.findUnique({ where: { id: coachMembership } })).toBeNull();
    const log = await rawDb.auditLog.findFirst({
      where: { action: "membership.removed", targetId: coachMembership },
    });
    expect(log?.metadata).toMatchObject({ role: "scout" });
  });

  it("cannot reach another organisation's membership", async () => {
    const other = await f.org("Elsewhere");
    const u = await f.user("Elsewhere Coach");
    const m = await f.member(other.id, u.id, "coach");
    await expect(removeMembership(asOwner, m.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("organisation settings", () => {
  it("changes name, type, country and region, and audits organisation.updated", async () => {
    const res = await updateOrganisationSettings(asOwner, {
      name: `Renamed FC ${f.tag}`,
      type: "academy",
      country: "NA",
      region: "Khomas",
    });
    expect(res.changed.sort()).toEqual(["country", "name", "region", "type"]);
    const row = await rawDb.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(row).toMatchObject({
      name: `Renamed FC ${f.tag}`,
      type: "academy",
      country: "NA",
      region: "Khomas",
    });
    const log = await rawDb.auditLog.findFirst({
      where: { action: "organisation.updated", targetId: org.id },
    });
    expect(log?.metadata).toMatchObject({ to: { country: "NA", type: "academy" } });
  });

  it("writes no audit row when nothing changed", async () => {
    const before = await rawDb.auditLog.count({
      where: { action: "organisation.updated", targetId: org.id },
    });
    const res = await updateOrganisationSettings(asOwner, {
      name: `Renamed FC ${f.tag}`,
      type: "academy",
      country: "NA",
      region: "Khomas",
    });
    expect(res.changed).toEqual([]);
    expect(
      await rawDb.auditLog.count({ where: { action: "organisation.updated", targetId: org.id } }),
    ).toBe(before);
  });

  it("refuses type platform, and a type change on the platform organisation", async () => {
    await expect(
      updateOrganisationSettings(asOwner, {
        name: "x",
        type: "platform" as "club",
        country: "ZA",
      }),
    ).rejects.toThrow();
    const platform = await f.org("Platform org", { type: "platform" });
    const pa = await f.user("Platform Owner");
    await f.member(platform.id, pa.id, "owner");
    const asPlatform = await f.ctx(pa, platform.id);
    await expect(
      updateOrganisationSettings(asPlatform, { name: "p", type: "club", country: "ZA" }),
    ).rejects.toBeInstanceOf(SettingsError);
    await updateOrganisationSettings(asPlatform, {
      name: `Platform renamed ${f.tag}`,
      country: "ZA",
    });
    expect((await rawDb.organisation.findUniqueOrThrow({ where: { id: platform.id } })).type).toBe(
      "platform",
    );
  });
});
