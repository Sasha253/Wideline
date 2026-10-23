import { randomBytes } from "node:crypto";
import type { ScoutStatus } from "@/generated/prisma/enums";
import { rawDb } from "@/server/db/raw";
import { ensureScoutNetwork, SCOUT_NETWORK_ORG_ID } from "@/server/scouts/network";
import { REVIEWER_TERMS_VERSION } from "@/server/scouts/terms";

// Scout fixtures for the C02 integration tests: a profile written directly, with
// a random hash, plus the scout network membership. Rows go with their user
// (cascade), so fixtures().cleanup() removes them.

/** Appends the Luhn check digit to 12 digits: a valid South African ID shape. */
export function saId(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(first12[11 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return `${first12}${(10 - (sum % 10)) % 10}`;
}

/** A random valid adult SA ID, so test files never collide on idNumberHash. */
export function randomSaId(): string {
  const serial = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  return saId(`800101${serial}`);
}

export async function scoutProfile(
  userId: string,
  {
    status = "pending",
    termsVersion = REVIEWER_TERMS_VERSION,
    membership = true,
  }: { status?: ScoutStatus; termsVersion?: string; membership?: boolean } = {},
) {
  if (membership) {
    await ensureScoutNetwork();
    await rawDb.membership.upsert({
      where: {
        organisationId_userId_role: { organisationId: SCOUT_NETWORK_ORG_ID, userId, role: "scout" },
      },
      update: {},
      create: {
        organisationId: SCOUT_NETWORK_ORG_ID,
        userId,
        role: "scout",
        acceptedAt: new Date(),
      },
    });
  }
  const now = new Date();
  return rawDb.scoutProfile.create({
    data: {
      userId,
      status,
      idDocumentType: "passport",
      idCountry: "GB",
      idNumberHash: randomBytes(32).toString("hex"),
      phone: "+27821234567",
      termsAcceptedAt: now,
      termsVersion,
      ...(status === "approved" && { verifiedAt: now }),
      ...(status === "suspended" && {
        verifiedAt: now,
        suspendedAt: now,
        suspensionReason: "Test",
      }),
    },
  });
}
