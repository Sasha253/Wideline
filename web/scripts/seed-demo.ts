/**
 * Demo data for local development, on top of `make seed` (run that first).
 *
 * Wideline Demo FC gets four squads of fictional named players with every
 * consent state, three opposition teams of placeholders, and a season of draft
 * matches with lineups and substitutions. Club staff, scouts, invitations and a
 * review queue of organisation applications fill the admin screens.
 *
 * A user for every role: a club owner, player and guardian at Demo FC, an
 * agency with an owner and an agent, and independent scouts in every review
 * state. All demo users share one password.
 *
 * Wideline Lab is left alone: its lineups stay shirt-number placeholders
 * (NFR-08). Names here are invented. Re-running adds any missing users and
 * resets their password; squads, matches and applications are made once.
 * `make reset` starts over.
 */
import "dotenv/config";
import { createHash, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { ConsentRelationship, ConsentState, Role } from "@/generated/prisma/enums";
import { CONSENT_WORDING_VERSION } from "../src/server/consent/wording";
import { rawDb as db } from "../src/server/db/raw";
import { ensureSubscription } from "../src/server/entitlements/plans";
import { ensureScoutNetwork, SCOUT_NETWORK_ORG_ID } from "../src/server/scouts/network";
import { REVIEWER_TERMS_VERSION } from "../src/server/scouts/terms";

const DEMO_ORG_NAME = "Wideline Demo FC";
const DEMO_AGENCY_NAME = "Wideline Demo Agency";
const SEASON = "2026";

type Scout = {
  email: string;
  name: string;
  status: "pending" | "approved" | "suspended" | "rejected";
  passport: string;
};
const SCOUTS: readonly Scout[] = [
  {
    email: "scout@wideline.localhost",
    name: "Pieter van Wyk",
    status: "approved",
    passport: "M00412871",
  },
  {
    email: "scout2@wideline.localhost",
    name: "Zanele Mthembu",
    status: "approved",
    passport: "A09981234",
  },
  {
    email: "scout.pending@wideline.localhost",
    name: "Naledi Khumalo",
    status: "pending",
    passport: "P55120943",
  },
  {
    email: "scout.new@wideline.localhost",
    name: "Chris Jacobs",
    status: "pending",
    passport: "X7720015",
  },
];
// Added on every run, like the other roles, so older demo databases get them.
const EXTRA_SCOUTS: readonly Scout[] = [
  {
    email: "scout.suspended@wideline.localhost",
    name: "Johan Steyn",
    status: "suspended",
    passport: "S31877420",
  },
  {
    email: "scout.rejected@wideline.localhost",
    name: "Ashley Brink",
    status: "rejected",
    passport: "R60294415",
  },
];
const DAY = 24 * 60 * 60 * 1000;

const STARTERS = ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CM", "RW", "ST", "LW"];
const BENCH = ["GK", "CB", "CM", "RW", "ST"];

const SQUADS = [
  {
    name: "Demo FC U13",
    ageGroup: "U13",
    birthYear: 2014,
    halfLength: 30,
    opposition: "Eastgate United U13",
  },
  {
    name: "Demo FC U15",
    ageGroup: "U15",
    birthYear: 2012,
    halfLength: 35,
    opposition: "Northside Academy U15",
  },
  {
    name: "Demo FC U17",
    ageGroup: "U17",
    birthYear: 2010,
    halfLength: 40,
    opposition: "Rivers FC U17",
  },
  {
    name: "Demo FC Seniors",
    ageGroup: "Senior",
    birthYear: 2001,
    halfLength: 45,
    opposition: "Rivers FC Seniors",
  },
];

const FIRST = [
  "Thabo",
  "Kagiso",
  "Liam",
  "Sibusiso",
  "Ethan",
  "Bongani",
  "Tshepo",
  "Jayden",
  "Lwazi",
  "Mpho",
  "Neo",
  "Ruan",
  "Ayanda",
  "Kyle",
  "Siyabonga",
  "Tumelo",
  "Junior",
  "Musa",
  "Daniel",
  "Lethabo",
  "Andile",
  "Keegan",
];
const LAST = [
  "Nkosi",
  "Botha",
  "Mahlangu",
  "Naidoo",
  "Molefe",
  "Pillay",
  "Van der Merwe",
  "Zulu",
  "Sithole",
  "Petersen",
  "Mokoena",
  "Khumalo",
  "Ndlovu",
  "Smith",
  "Mabaso",
  "Fourie",
  "Govender",
  "Dube",
  "Radebe",
];
const GUARDIAN_FIRST = [
  "Nomsa",
  "Sarah",
  "Precious",
  "Johan",
  "Busisiwe",
  "Priya",
  "Themba",
  "Michelle",
];

// The token and ID hashes, as in src/server/organisations/tokens.ts and
// src/server/scouts/identity.ts, which are server-only and cannot load here.
const tokenHash = () =>
  createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");
function passportHash(number: string): string {
  const secret =
    process.env.ID_HASH_SECRET ||
    Buffer.from(
      hkdfSync("sha256", process.env.BETTER_AUTH_SECRET!, "", "wideline:scout-id:v1", 32),
    ).toString("hex");
  return createHmac("sha256", secret).update(`passport:ZA:${number}`).digest("hex");
}

// Deterministic, so every machine gets the same demo squads.
let state = 20261028;
function rand(): number {
  state = (state * 1664525 + 1013904223) % 2 ** 32;
  return state / 2 ** 32;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

// Consent mix for each squad, by squad position: mostly granted, some waiting,
// a refusal and a withdrawal so every badge and filter has something in it.
const CONSENT_PLAN: (ConsentState | "refused")[] = [
  "scout_visible",
  "scout_visible",
  "club_only",
  "scout_visible",
  "requested",
  "scout_visible",
  "club_only",
  "none",
  "scout_visible",
  "withdrawn",
  "club_only",
  "scout_visible",
  "requested",
  "refused",
  "scout_visible",
  "none",
];

async function main() {
  const demo = await db.organisation.findFirst({ where: { name: DEMO_ORG_NAME } });
  const owner = await db.user.findUnique({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@wideline.localhost" },
  });
  if (!demo || !owner) throw new Error("Run `make seed` first.");

  const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(12).toString("base64url");
  const hash = await hashPassword(password);
  // Demo users only, never the seeded admin: every run resets their password to
  // this run's, so the one printed at the end signs in to all of them.
  const createUser = async (email: string, name: string) => {
    const user = await db.user.upsert({
      where: { email },
      update: {},
      create: { id: randomUUID(), email, name, emailVerified: true },
    });
    const credential = await db.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    if (credential) {
      await db.account.update({ where: { id: credential.id }, data: { password: hash } });
    } else {
      await db.account.create({
        data: {
          id: randomUUID(),
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password: hash,
        },
      });
    }
    return user;
  };
  const join = (organisationId: string, userId: string, role: Role) =>
    db.membership.upsert({
      where: { organisationId_userId_role: { organisationId, userId, role } },
      update: {},
      create: { organisationId, userId, role, invitedById: owner.id, acceptedAt: new Date() },
    });

  // --- Club staff -----------------------------------------------------------
  const clubAdmin = await createUser("clubadmin@wideline.localhost", "Lerato Mokoena");
  const coach = await createUser("coach@wideline.localhost", "Sipho Dlamini");
  const clubScout = await createUser("analyst@wideline.localhost", "Megan Fourie");
  await join(demo.id, clubAdmin.id, "admin");
  await join(demo.id, coach.id, "coach");
  await join(demo.id, clubScout.id, "scout");

  // An independent scout with a profile in each review state (AUTH08 to AUTH10, ADMIN06).
  const addScout = async (s: Scout) => {
    const user = await createUser(s.email, s.name);
    const now = new Date();
    await db.scoutProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        status: s.status,
        idDocumentType: "passport",
        idCountry: "ZA",
        idNumberHash: passportHash(s.passport),
        phone: `+2782${between(1000000, 9999999)}`,
        termsAcceptedAt: now,
        termsVersion: REVIEWER_TERMS_VERSION,
        ...(s.status === "pending" ? {} : { reviewedAt: now, reviewedById: owner.id }),
        ...(s.status === "approved" || s.status === "suspended" ? { verifiedAt: now } : {}),
        ...(s.status === "suspended"
          ? { suspendedAt: now, suspensionReason: "Reviews did not match the footage." }
          : {}),
        ...(s.status === "rejected"
          ? { rejectionReason: "Could not confirm the identity document." }
          : {}),
        affiliations: {
          create: [
            {
              type: "club",
              name: "Former youth coach",
              clubName: pick(["Rivers FC", "Cape Coast FC", "Eastgate United"]),
            },
          ],
        },
      },
    });
    await join(SCOUT_NETWORK_ORG_ID, user.id, "scout");
  };

  // --- Every other role (owner, agent, player, guardian) ---------------------
  // Added on every run, so a database seeded before these existed gets them too.
  // Player and guardian accounts are memberships only: no screen links them to
  // a squad player yet.
  const clubOwner = await createUser("owner@wideline.localhost", "Thandi Zulu");
  const player = await createUser("player@wideline.localhost", "Kagiso Molefe");
  const guardian = await createUser("guardian@wideline.localhost", "Nomsa Nkosi");
  await join(demo.id, clubOwner.id, "owner");
  await join(demo.id, player.id, "player");
  await join(demo.id, guardian.id, "guardian");

  const agency =
    (await db.organisation.findFirst({ where: { name: DEMO_AGENCY_NAME } })) ??
    (await db.organisation.create({
      data: {
        name: DEMO_AGENCY_NAME,
        type: "agency",
        country: "ZA",
        region: "Western Cape",
        status: "active",
      },
    }));
  await ensureSubscription(db, agency.id);
  const agencyOwner = await createUser("agency@wideline.localhost", "Ryan Pillay");
  const agent = await createUser("agent@wideline.localhost", "Fatima Hendricks");
  await join(agency.id, agencyOwner.id, "owner");
  await join(agency.id, agent.id, "agent");

  await ensureScoutNetwork(db);
  for (const s of EXTRA_SCOUTS) await addScout(s);

  if (await db.team.findFirst({ where: { organisationId: demo.id, name: SQUADS[0]!.name } })) {
    console.log("\nDemo users are up to date. Squads and matches were already present.");
    console.log("  `make reset && make up && make seed && make demo` starts over.");
    printUsers(password);
    return;
  }

  for (const [email, inviteeName, role] of [
    ["coach.u13@wideline.localhost", "Bheki Ntuli", "coach"],
    ["physio@wideline.localhost", "Anika Joubert", "coach"],
  ] as const) {
    await db.invitation.create({
      data: {
        organisationId: demo.id,
        email,
        inviteeName,
        role,
        tokenHash: tokenHash(),
        invitedById: owner.id,
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
  }

  // --- Squads, consent and matches -----------------------------------------
  let playerCount = 0;
  let matchCount = 0;
  for (const squad of SQUADS) {
    const [team, opposition] = await Promise.all(
      [squad.name, squad.opposition].map((name) =>
        db.team.create({
          data: {
            organisationId: demo.id,
            name,
            ageGroup: squad.ageGroup,
            gender: "male",
            season: SEASON,
            isOpposition: name === squad.opposition,
          },
        }),
      ),
    );

    const players = [];
    for (const [i, position] of [...STARTERS, ...BENCH].entries()) {
      const dob = new Date(
        Date.UTC(
          squad.birthYear - (squad.ageGroup === "Senior" ? between(0, 6) : 0),
          between(0, 11),
          between(1, 28),
        ),
      );
      players.push(
        await db.player.create({
          data: {
            organisationId: demo.id,
            teamId: team!.id,
            firstName: pick(FIRST),
            lastName: pick(LAST),
            dateOfBirth: dob,
            position,
            preferredFoot: pick(["right", "right", "right", "left", "both"] as const),
            heightCm: between(
              squad.ageGroup === "U13" ? 140 : 160,
              squad.ageGroup === "U13" ? 165 : 192,
            ),
            squadNumber: i + 1,
          },
        }),
      );
    }
    // One player left the club mid-season (SQUAD09).
    await db.player.create({
      data: {
        organisationId: demo.id,
        teamId: team!.id,
        firstName: pick(FIRST),
        lastName: pick(LAST),
        dateOfBirth: new Date(Date.UTC(squad.birthYear, 5, 12)),
        position: "CM",
        preferredFoot: "right",
        squadNumber: 21,
        clubStatus: "departed",
        departedAt: new Date("2026-09-30T12:00:00Z"),
      },
    });
    playerCount += players.length + 1;

    for (const [i, player] of players.entries()) {
      await recordConsent(demo.id, owner.id, player, CONSENT_PLAN[i]!, squad.ageGroup === "Senior");
    }

    const oppositionPlayers = [];
    for (const [i, position] of [...STARTERS, ...BENCH.slice(0, 3)].entries()) {
      oppositionPlayers.push(
        await db.player.create({
          data: {
            organisationId: demo.id,
            teamId: opposition!.id,
            isPlaceholder: true,
            squadNumber: i + 1,
            position,
          },
        }),
      );
    }

    // Two played fixtures with lineups (home, then away) and one upcoming.
    const fixtures = [
      {
        daysAgo: 24,
        home: true,
        venue: "Demo FC Main Field",
        competition: "Gauteng Youth League",
        lineups: true,
      },
      {
        daysAgo: 10,
        home: false,
        venue: `${squad.opposition.split(" ")[0]} Sports Ground`,
        competition: "Gauteng Youth League",
        lineups: true,
      },
      {
        daysAgo: -6,
        home: true,
        venue: "Demo FC Main Field",
        competition: "Cup, round 1",
        lineups: false,
      },
    ];
    for (const f of fixtures) {
      const playedAt = new Date(Date.now() - f.daysAgo * DAY);
      playedAt.setUTCHours(8 + SQUADS.indexOf(squad) * 2, 0, 0, 0);
      const match = await db.match.create({
        data: {
          organisationId: demo.id,
          homeTeamId: f.home ? team!.id : opposition!.id,
          awayTeamId: f.home ? opposition!.id : team!.id,
          playedAt,
          venue: f.venue,
          competition:
            squad.ageGroup === "Senior" ? f.competition.replace("Youth ", "") : f.competition,
          halfLengthMinutes: squad.halfLength,
          createdByUserId: coach.id,
        },
      });
      matchCount++;
      if (!f.lineups) continue;
      const fullTime = squad.halfLength * 2 * 60;
      await addLineup(demo.id, match.id, team!.id, players, fullTime);
      await addLineup(demo.id, match.id, opposition!.id, oppositionPlayers, fullTime);
    }
  }

  // --- Scouts (AUTH08 to AUTH10) --------------------------------------------
  for (const s of SCOUTS) await addScout(s);

  // --- Platform review queue (ADMIN01) --------------------------------------
  const applications = [
    {
      name: "Soweto Stars Academy",
      type: "academy",
      region: "Gauteng",
      applicantName: "Kabelo Moloi",
      status: "pending",
    },
    {
      name: "Cape Coast FC",
      type: "club",
      region: "Western Cape",
      applicantName: "Jessica Adams",
      status: "pending",
    },
    {
      name: "Kickoff Sports Agency",
      type: "agency",
      region: "KwaZulu-Natal",
      applicantName: "Vusi Mthethwa",
      status: "pending",
    },
    {
      name: "Durban Dolphins FC",
      type: "club",
      region: "KwaZulu-Natal",
      applicantName: "Ravi Moodley",
      status: "suspended",
    },
    {
      name: "Test Club Please Ignore",
      type: "club",
      region: "Gauteng",
      applicantName: "Test User",
      status: "rejected",
    },
  ] as const;
  for (const [i, a] of applications.entries()) {
    if (await db.organisation.findFirst({ where: { name: a.name } })) continue;
    const org = await db.organisation.create({
      data: {
        name: a.name,
        type: a.type,
        country: "ZA",
        region: a.region,
        status: a.status,
        applicantName: a.applicantName,
        applicantEmail: `${a.applicantName.split(" ")[0]!.toLowerCase()}@example.com`,
        createdAt: new Date(Date.now() - (i + 1) * 2 * DAY),
        ...(a.status === "pending" ? {} : { reviewedAt: new Date(Date.now() - DAY) }),
        ...(a.status === "rejected" ? { rejectionReason: "Duplicate test application." } : {}),
      },
    });
    await ensureSubscription(db, org.id);
  }

  console.log("\nDemo data complete.");
  console.log(
    `  ${DEMO_ORG_NAME}: ${SQUADS.length} squads, ${playerCount} players, ${matchCount} matches`,
  );
  printUsers(password);
}

function printUsers(password: string) {
  console.log("  Users (all share this password):");
  for (const line of [
    `owner@wideline.localhost (${DEMO_ORG_NAME} owner)`,
    `clubadmin@wideline.localhost (${DEMO_ORG_NAME} admin)`,
    `coach@wideline.localhost (${DEMO_ORG_NAME} coach)`,
    `analyst@wideline.localhost (${DEMO_ORG_NAME} scout)`,
    `player@wideline.localhost (${DEMO_ORG_NAME} player)`,
    `guardian@wideline.localhost (${DEMO_ORG_NAME} guardian)`,
    `agency@wideline.localhost (${DEMO_AGENCY_NAME} owner)`,
    `agent@wideline.localhost (${DEMO_AGENCY_NAME} agent)`,
    ...[...SCOUTS, ...EXTRA_SCOUTS].map((s) => `${s.email} (${s.status} independent scout)`),
  ]) {
    console.log(`    ${line}`);
  }
  console.log(`  Password: ${password}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log("  (generated; set SEED_ADMIN_PASSWORD in .env to choose one)");
  }
  console.log("  The seeded admin can also open any of them from Admin > Users > Log in as.");
}

/** Writes the consent rows for one player; the trigger keeps Player.consentState in step. */
async function recordConsent(
  organisationId: string,
  recordedById: string,
  player: { id: string; lastName: string | null },
  plan: ConsentState | "refused",
  adult: boolean,
) {
  if (plan === "none") return;
  const relationship: ConsentRelationship = adult
    ? "self"
    : pick(["parent", "parent", "legal_guardian", "grandparent"]);
  const grantedBy = adult ? "The player" : `${pick(GUARDIAN_FIRST)} ${player.lastName}`;
  const grantedAt = new Date(Date.now() - between(15, 50) * DAY);
  const base = { organisationId, playerId: player.id, playerWasMinor: !adult, recordedById };

  if (plan === "requested") {
    const request = await db.consentRequest.create({
      data: {
        organisationId,
        playerId: player.id,
        tokenHash: tokenHash(),
        createdById: recordedById,
        expiresAt: new Date(Date.now() + 10 * DAY),
      },
    });
    await db.consent.create({
      data: {
        ...base,
        state: "requested",
        clubStats: false,
        scoutVisible: false,
        requestId: request.id,
      },
    });
    return;
  }

  const grant = {
    grantedBy,
    relationship,
    method: pick(["paper_form", "in_person"] as const),
    wordingVersion: CONSENT_WORDING_VERSION,
    grantedAt,
  };
  if (plan === "refused") {
    await db.consent.create({
      data: { ...base, ...grant, state: "none", clubStats: false, scoutVisible: false },
    });
    return;
  }
  const granted = plan === "withdrawn" ? "club_only" : plan;
  await db.consent.create({
    data: {
      ...base,
      ...grant,
      state: granted,
      clubStats: true,
      scoutVisible: granted === "scout_visible",
    },
  });
  if (plan === "withdrawn") {
    await db.consent.create({
      data: {
        ...base,
        state: "withdrawn",
        clubStats: false,
        scoutVisible: false,
        grantedBy,
        relationship,
        method: "email",
        withdrawnAt: new Date(grantedAt.getTime() + 9 * DAY),
      },
    });
  }
}

/** Eleven starters, three substitutions in the second half, the rest unused on the bench. */
async function addLineup(
  organisationId: string,
  matchId: string,
  teamId: string,
  squad: { id: string; squadNumber: number | null; position: string | null }[],
  fullTime: number,
) {
  const row = (p: (typeof squad)[number], isStarter: boolean) => ({
    organisationId,
    matchId,
    teamId,
    playerId: p.id,
    shirtNumber: p.squadNumber!,
    position: p.position,
    isStarter,
    startedAt: isStarter ? 0 : null,
  });
  const starters = [];
  for (const p of squad.slice(0, 11)) starters.push(await db.lineup.create({ data: row(p, true) }));

  // Bench GK stays on; the next three outfield subs replace a defender, a midfielder and a forward.
  const subs = squad.slice(11).filter((p) => p.position !== "GK");
  const replaced = [starters[3]!, starters[6]!, starters[9]!];
  const minutes = [0.6, 0.7, 0.85];
  for (const [i, p] of subs.entries()) {
    if (i >= replaced.length) {
      await db.lineup.create({ data: row(p, false) });
      continue;
    }
    const at = Math.round(fullTime * minutes[i]!);
    await db.lineup.update({ where: { id: replaced[i]!.id }, data: { endedAt: at } });
    await db.lineup.create({
      data: { ...row(p, false), startedAt: at, replacesLineupId: replaced[i]!.id },
    });
  }
  for (const p of squad.slice(11).filter((p) => p.position === "GK")) {
    await db.lineup.create({ data: row(p, false) });
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
