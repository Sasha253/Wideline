import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "@/server/db/raw";
import { log } from "@/server/log";
import type { RegistrationInput } from "@/server/scouts/fields";
import { SCOUT_NETWORK_ORG_ID } from "@/server/scouts/network";
import { registerScout } from "@/server/scouts/registration";
import { REVIEWER_TERMS_VERSION } from "@/server/scouts/terms";
import { fixtures } from "./helpers/fixtures";
import { randomSaId } from "./helpers/scouts";

// AUTH08, AUTH09, AUTH10 (C02 acceptance): public scout registration. The raw ID
// number is never stored, logged or audited; one identity registers once.

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("@/server/mail", () => ({ sendMail }));

const f = fixtures();
const emailOf = (local: string) => `${local}-${f.tag}@test.local`;

// Everything the logger is asked to write during this file.
const logged: string[] = [];
for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
  const original = log[level].bind(log);
  vi.spyOn(log, level).mockImplementation(((...args: unknown[]) => {
    logged.push(JSON.stringify(args, (_k, v) => (v instanceof Error ? v.stack : v)));
    return (original as (...a: unknown[]) => void)(...args);
  }) as never);
}

function input(local: string, idNumber: string, extra: Partial<RegistrationInput> = {}) {
  return {
    name: "Sipho Ndlovu",
    email: emailOf(local),
    phone: "082 123 4567",
    idDocumentType: "sa_id",
    idNumber,
    clubName: ["Hellenic FC"],
    playerName: ["Thabo Mokoena"],
    playerClub: ["Kaizer Chiefs"],
    noAffiliations: false,
    acceptTerms: true,
    ...extra,
  } satisfies RegistrationInput;
}

async function register(local: string, idNumber: string, extra: Partial<RegistrationInput> = {}) {
  try {
    return await registerScout({ input: input(local, idNumber, extra) });
  } finally {
    await f.trackUserByEmail(emailOf(local));
  }
}

/** Every row of a table as JSON text. */
async function tableText(table: string): Promise<string> {
  const rows = await rawDb.$queryRawUnsafe<{ t: string }[]>(
    `SELECT row_to_json(x)::text AS t FROM "${table}" x`,
  );
  return rows.map((r) => r.t).join("\n");
}

beforeEach(() => {
  sendMail.mockReset();
});

afterAll(async () => {
  await f.cleanup();
});

describe("registerScout, signed out", () => {
  const id = randomSaId();

  it("creates the user, pending profile, affiliations and network membership", async () => {
    const res = await register("new", id);
    expect(res.createdUser).toBe(true);
    expect(res.emailSent).toBe(true);

    const user = await rawDb.user.findUniqueOrThrow({
      where: { id: res.userId },
      include: { accounts: true, sessions: true, memberships: true, scoutProfile: true },
    });
    // Nothing proves the email yet: no password, no OAuth link, no session.
    expect(user.emailVerified).toBe(false);
    expect(user.accounts).toEqual([]);
    expect(user.sessions).toEqual([]);
    expect(user.memberships).toEqual([
      expect.objectContaining({ organisationId: SCOUT_NETWORK_ORG_ID, role: "scout" }),
    ]);
    expect(user.memberships[0]!.acceptedAt).not.toBeNull();
    expect(user.scoutProfile).toMatchObject({
      status: "pending",
      idDocumentType: "sa_id",
      idCountry: "ZA",
      phone: "+27821234567",
      termsVersion: REVIEWER_TERMS_VERSION,
    });
    expect(user.scoutProfile!.termsAcceptedAt).toBeInstanceOf(Date);
    expect(user.scoutProfile!.idNumberHash).toMatch(/^[0-9a-f]{64}$/);

    const affiliations = await rawDb.scoutAffiliation.findMany({
      where: { scoutUserId: res.userId },
      orderBy: { type: "asc" },
    });
    expect(affiliations).toEqual([
      expect.objectContaining({ type: "club", name: "Hellenic FC", clubName: null }),
      expect.objectContaining({
        type: "player",
        name: "Thabo Mokoena",
        clubName: "Kaizer Chiefs",
      }),
    ]);

    const audits = await rawDb.auditLog.findMany({
      where: { action: "scout.registered", actorUserId: res.userId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organisationId: null,
      targetType: "ScoutProfile",
      targetId: user.scoutProfile!.id,
      metadata: {
        idDocumentType: "sa_id",
        idCountry: "ZA",
        affiliationCount: 2,
        termsVersion: REVIEWER_TERMS_VERSION,
        createdUser: true,
      },
    });
    expect(sendMail).toHaveBeenCalledWith(
      emailOf("new"),
      "We have your scout registration",
      expect.stringContaining("/scout"),
    );
  });

  it("never stores, audits, emails or logs the raw ID number", async () => {
    for (const table of [
      "ScoutProfile",
      "ScoutAffiliation",
      "User",
      "Account",
      "Verification",
      "AuditLog",
      "Membership",
    ]) {
      expect(await tableText(table), table).not.toContain(id);
    }
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain(id);
    expect(logged.join("\n")).not.toContain(id);
  });

  it("refuses the same identity again, even with another email and spacing", async () => {
    const spaced = `${id.slice(0, 6)} ${id.slice(6, 10)} ${id.slice(10)}`;
    await expect(register("again", spaced)).rejects.toMatchObject({ code: "identity_taken" });
    expect(await rawDb.user.findUnique({ where: { email: emailOf("again") } })).toBeNull();
  });

  it("refuses an email that already has an account", async () => {
    await expect(register("new", randomSaId())).rejects.toMatchObject({
      code: "account_exists",
    });
  });

  it("creates nothing for a filled honeypot", async () => {
    await expect(register("bot", randomSaId(), { website: "http://spam" })).rejects.toMatchObject({
      code: "spam",
    });
    expect(await rawDb.user.findUnique({ where: { email: emailOf("bot") } })).toBeNull();
  });

  it("accepts an explicit no-conflicts declaration", async () => {
    const res = await register("none", randomSaId(), {
      clubName: [],
      playerName: [],
      playerClub: [],
      noAffiliations: true,
    });
    expect(await rawDb.scoutAffiliation.count({ where: { scoutUserId: res.userId } })).toBe(0);
  });

  it("gives one profile when two registrations with the same ID race", async () => {
    const shared = randomSaId();
    const results = await Promise.allSettled([
      register("race-a", shared),
      register("race-b", shared),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "identity_taken" });
    const users = await rawDb.user.findMany({
      where: { email: { in: [emailOf("race-a"), emailOf("race-b")] } },
      include: { scoutProfile: true },
    });
    expect(users.filter((u) => u.scoutProfile)).toHaveLength(1);
    // The loser's transaction rolled back: no orphan account either.
    expect(users).toHaveLength(1);
  });
});

describe("registerScout, signed in", () => {
  it("adds the profile to the current user, without name or email", async () => {
    const coach = await f.user("Signed In Coach");
    const res = await registerScout({
      input: { ...input("ignored", randomSaId()), name: "", email: "" },
      signedInUser: { id: coach.id, name: coach.name, email: coach.email },
    });
    expect(res).toMatchObject({ userId: coach.id, createdUser: false, email: coach.email });
    const profile = await rawDb.scoutProfile.findUniqueOrThrow({ where: { userId: coach.id } });
    expect(profile.status).toBe("pending");
    const membership = await rawDb.membership.findFirst({
      where: { userId: coach.id, organisationId: SCOUT_NETWORK_ORG_ID, role: "scout" },
    });
    expect(membership?.acceptedAt).not.toBeNull();
    expect(await rawDb.user.findUnique({ where: { email: emailOf("ignored") } })).toBeNull();

    await expect(
      registerScout({
        input: input("ignored", randomSaId()),
        signedInUser: { id: coach.id, name: coach.name, email: coach.email },
      }),
    ).rejects.toMatchObject({ code: "already_registered" });
  });
});
