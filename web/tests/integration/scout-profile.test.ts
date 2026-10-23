import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import { scoutConflicts } from "@/server/scouts/conflicts";
import { SCOUT_NETWORK_ORG_ID } from "@/server/scouts/network";
import {
  acceptCurrentTerms,
  addOwnAffiliation,
  getOwnScoutProfile,
  removeOwnAffiliation,
  updateOwnPhone,
} from "@/server/scouts/profile";
import { REVIEWER_TERMS_VERSION } from "@/server/scouts/terms";
import { fixtures } from "./helpers/fixtures";
import { scoutProfile } from "./helpers/scouts";

// AUTH09, AUTH10: a scout edits only their own phone, conflicts and terms; every
// change is audited. scoutConflicts is the helper C10 uses to block claims.

const f = fixtures();
let alice: { id: string };
let bob: { id: string };

async function audits(actorUserId: string, action: string) {
  return rawDb.auditLog.findMany({ where: { actorUserId, action } });
}

beforeAll(async () => {
  alice = await f.user("Alice Scout");
  bob = await f.user("Bob Scout");
  await scoutProfile(alice.id, { status: "approved", termsVersion: "2025-old" });
  await scoutProfile(bob.id);
});

afterAll(async () => {
  await f.cleanup();
});

describe("own profile", () => {
  it("returns the profile without the hash, and null without one", async () => {
    const p = await getOwnScoutProfile(alice.id);
    expect(p).toMatchObject({ status: "approved", termsCurrent: false });
    expect(p).not.toHaveProperty("idNumberHash");
    expect(await getOwnScoutProfile((await f.user("No profile")).id)).toBeNull();
  });

  it("changes the phone, audited once; an unchanged number writes nothing", async () => {
    expect(await updateOwnPhone(alice.id, "+44 7700 900123")).toEqual({
      changed: true,
      phone: "+447700900123",
    });
    expect(await updateOwnPhone(alice.id, "+447700900123")).toMatchObject({ changed: false });
    expect(await audits(alice.id, "scout.phone_changed")).toHaveLength(1);
    expect((await getOwnScoutProfile(bob.id))!.phone).toBe("+27821234567");
    await expect(updateOwnPhone(alice.id, "nope")).rejects.toThrow();
  });

  it("adds affiliations, refusing duplicates (case-insensitive) and over 30 of a type", async () => {
    await addOwnAffiliation(alice.id, { type: "club", name: "Hellenic FC" });
    await expect(
      addOwnAffiliation(alice.id, { type: "club", name: "hellenic fc" }),
    ).rejects.toMatchObject({ code: "duplicate" });
    await addOwnAffiliation(alice.id, { type: "player", name: "Hellenic FC", clubName: "" });
    await expect(addOwnAffiliation(alice.id, { type: "club", name: " " })).rejects.toThrow(
      "Enter the club name.",
    );
    const added = await audits(alice.id, "scout.affiliation_added");
    expect(added).toHaveLength(2);
    // A represented player is often a child: the append-only audit log keeps the
    // affiliation id (targetId) and type, never the name or club.
    for (const row of added) {
      expect(row.targetType).toBe("ScoutAffiliation");
      expect(row.targetId).toBeTruthy();
      expect(row.metadata).toEqual({ type: expect.any(String) });
      expect(JSON.stringify(row.metadata)).not.toContain("Hellenic");
    }

    for (let i = 0; i < 29; i++)
      await addOwnAffiliation(bob.id, { type: "club", name: `Club ${i}` });
    await addOwnAffiliation(bob.id, { type: "club", name: "Club 29" });
    await expect(
      addOwnAffiliation(bob.id, { type: "club", name: "Club 30" }),
    ).rejects.toMatchObject({
      code: "limit",
    });
  });

  it("removes softly, only the caller's own rows, audited", async () => {
    const [row] = (await getOwnScoutProfile(alice.id))!.affiliations;
    await expect(removeOwnAffiliation(bob.id, row!.id)).rejects.toMatchObject({
      code: "already_removed",
    });
    expect(
      (await rawDb.scoutAffiliation.findUniqueOrThrow({ where: { id: row!.id } })).removedAt,
    ).toBeNull();

    await removeOwnAffiliation(alice.id, row!.id);
    const kept = await rawDb.scoutAffiliation.findUniqueOrThrow({ where: { id: row!.id } });
    expect(kept.removedAt).toBeInstanceOf(Date);
    expect((await getOwnScoutProfile(alice.id))!.affiliations.map((a) => a.id)).not.toContain(
      row!.id,
    );
    await expect(removeOwnAffiliation(alice.id, row!.id)).rejects.toMatchObject({
      code: "already_removed",
    });
    const removed = await audits(alice.id, "scout.affiliation_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ targetId: row!.id, metadata: { type: row!.type } });
    expect(JSON.stringify(removed[0]!.metadata)).not.toContain(row!.name);
    // A removed name can be declared again.
    await addOwnAffiliation(alice.id, { type: "club", name: "Hellenic FC" });
  });

  it("accepts only the current terms version, audited", async () => {
    await expect(acceptCurrentTerms(alice.id, "2025-old")).rejects.toMatchObject({
      code: "terms_changed",
    });
    await acceptCurrentTerms(alice.id, REVIEWER_TERMS_VERSION);
    const p = await getOwnScoutProfile(alice.id);
    expect(p).toMatchObject({ termsVersion: REVIEWER_TERMS_VERSION, termsCurrent: true });
    expect((await getOwnScoutProfile(bob.id))!.termsVersion).toBe(REVIEWER_TERMS_VERSION);
    const rows = await audits(alice.id, "scout.terms_accepted");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ termsVersion: REVIEWER_TERMS_VERSION });
  });
});

describe("scoutConflicts", () => {
  it("returns linked active affiliations and accepted memberships, nothing else", async () => {
    const u = await f.user("Conflicted Scout");
    await scoutProfile(u.id);
    const [linkedClub, playersClub, removedClub, memberClub, invitedClub, platform] =
      await Promise.all([
        f.org("Linked club"),
        f.org("Players club"),
        f.org("Removed club"),
        f.org("Member club"),
        f.org("Invited club"),
        f.org("Platform", { type: "platform" }),
      ]);
    await rawDb.scoutAffiliation.createMany({
      data: [
        { scoutUserId: u.id, type: "club", name: "Linked", organisationId: linkedClub.id },
        {
          scoutUserId: u.id,
          type: "player",
          name: "Thabo",
          clubName: "Players club",
          organisationId: playersClub.id,
        },
        {
          scoutUserId: u.id,
          type: "club",
          name: "Removed",
          organisationId: removedClub.id,
          removedAt: new Date(),
        },
        { scoutUserId: u.id, type: "club", name: "Not linked yet" },
      ],
    });
    await f.member(memberClub.id, u.id, "coach");
    await f.member(platform.id, u.id, "platform_admin");
    // An invitation not yet accepted is no conflict.
    await rawDb.membership.create({
      data: { organisationId: invitedClub.id, userId: u.id, role: "coach" },
    });

    const { organisationIds } = await scoutConflicts(u.id);
    expect(organisationIds.sort()).toEqual([linkedClub.id, playersClub.id, memberClub.id].sort());
    expect(organisationIds).not.toContain(SCOUT_NETWORK_ORG_ID);
  });

  it("counts an unlinked declaration whose name matches an active organisation, case-insensitively", async () => {
    const u = await f.user("Name Match Scout");
    await scoutProfile(u.id);
    const [club, twinClub, twinAcademy, agency, pendingOrg, removedMatch, checkedMatch] =
      await Promise.all([
        f.org("Ajax Cape Town"),
        f.org("Twin Name"),
        f.org("Twin Name", { type: "academy" }),
        f.org("Agency Name", { type: "agency" }),
        f.org("Pending Name", { status: "pending" }),
        f.org("Removed Match"),
        f.org("Checked Match"),
      ]);
    await rawDb.scoutAffiliation.createMany({
      data: [
        // Declared, nobody linked it: blocks from the start.
        { scoutUserId: u.id, type: "club", name: ` ${club.name.toUpperCase()} ` },
        // A represented player's club with two same-named organisations: both block.
        { scoutUserId: u.id, type: "player", name: "Sipho", clubName: twinClub.name.toLowerCase() },
        { scoutUserId: u.id, type: "club", name: agency.name },
        // Not active: no conflict.
        { scoutUserId: u.id, type: "club", name: pendingOrg.name },
        // Removed by the scout: no conflict.
        { scoutUserId: u.id, type: "club", name: removedMatch.name, removedAt: new Date() },
        // An admin saved Not matched, but the name still equals an organisation's.
        { scoutUserId: u.id, type: "club", name: checkedMatch.name, linkedAt: new Date() },
        // A player without a club, and a name nobody uses: nothing to match.
        { scoutUserId: u.id, type: "player", name: club.name },
        { scoutUserId: u.id, type: "club", name: "Nobody FC" },
      ],
    });

    const { organisationIds } = await scoutConflicts(u.id);
    expect(organisationIds).toEqual(
      [club.id, twinClub.id, twinAcademy.id, agency.id, checkedMatch.id].sort(),
    );
  });
});
