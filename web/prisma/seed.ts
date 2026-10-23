/**
 * Local seed: the Wideline Lab platform organisation, one platform admin with a
 * password, two teams of 11 placeholder players, and one match with both
 * lineups. A second active demo club, with the admin as owner, lets the
 * organisation switch (AUTH05) work locally and in e2e. Safe to re-run.
 *
 * Players are shirt-number placeholders, not named people, so the Lab never
 * derives per-player data about a named, non-consented child (NFR-08).
 */
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { rawDb as db } from "../src/server/db/raw";

const ORG_NAME = "Wideline Lab";
const DEMO_ORG_NAME = "Wideline Demo FC";
const POSITIONS = ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CM", "RW", "ST", "LW"];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@wideline.localhost";
  const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(12).toString("base64url");

  const org =
    (await db.organisation.findFirst({ where: { name: ORG_NAME } })) ??
    (await db.organisation.create({
      data: {
        name: ORG_NAME,
        type: "platform",
        country: "ZA",
        region: "Gauteng",
        // Organisations default to pending (ADMIN01); the platform one is active.
        status: "active",
      },
    }));
  if (org.status !== "active") {
    await db.organisation.update({ where: { id: org.id }, data: { status: "active" } });
  }
  const demo =
    (await db.organisation.findFirst({ where: { name: DEMO_ORG_NAME } })) ??
    (await db.organisation.create({
      data: {
        name: DEMO_ORG_NAME,
        type: "club",
        country: "ZA",
        region: "Gauteng",
        status: "active",
      },
    }));

  // Better Auth users and credential accounts, written directly because
  // sign-up is disabled. The password hash uses Better Auth's own hasher.
  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { id: randomUUID(), email, name: "Lab Admin", emailVerified: true },
  });
  const hash = await hashPassword(password);
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

  await db.membership.upsert({
    where: {
      organisationId_userId_role: {
        organisationId: org.id,
        userId: user.id,
        role: "platform_admin",
      },
    },
    update: {},
    create: {
      organisationId: org.id,
      userId: user.id,
      role: "platform_admin",
      acceptedAt: new Date(),
    },
  });

  await db.membership.upsert({
    where: {
      organisationId_userId_role: { organisationId: demo.id, userId: user.id, role: "owner" },
    },
    update: {},
    create: { organisationId: demo.id, userId: user.id, role: "owner", acceptedAt: new Date() },
  });

  const existingMatch = await db.match.findFirst({ where: { organisationId: org.id } });
  if (!existingMatch) {
    const season = "2026";
    const [home, away] = await Promise.all(
      ["Lab Academy U17", "Opposition U17"].map((name) =>
        db.team.create({
          data: { organisationId: org.id, name, ageGroup: "U17", season },
        }),
      ),
    );

    const playersFor = async (teamId: string) =>
      Promise.all(
        POSITIONS.map((position, i) =>
          db.player.create({
            data: {
              organisationId: org.id,
              teamId,
              isPlaceholder: true,
              squadNumber: i + 1,
              position,
            },
          }),
        ),
      );
    const [homePlayers, awayPlayers] = await Promise.all([
      playersFor(home!.id),
      playersFor(away!.id),
    ]);

    const match = await db.match.create({
      data: {
        organisationId: org.id,
        homeTeamId: home!.id,
        awayTeamId: away!.id,
        playedAt: new Date("2026-10-18T10:00:00+02:00"),
        venue: "Lab Training Ground",
        competition: "Friendly",
      },
    });

    await db.lineup.createMany({
      data: [
        ...homePlayers.map((p) => ({ teamId: home!.id, player: p })),
        ...awayPlayers.map((p) => ({ teamId: away!.id, player: p })),
      ].map(({ teamId, player }) => ({
        organisationId: org.id,
        matchId: match.id,
        teamId,
        playerId: player.id,
        shirtNumber: player.squadNumber!,
        position: player.position,
        isStarter: true,
        startedAt: 0,
      })),
    });
  }

  console.log("\nSeed complete.");
  console.log(`  Organisations: ${org.name} (platform admin), ${demo.name} (owner)`);
  console.log(`  Sign in at:   ${process.env.APP_URL ?? "http://wideline.localhost"}/login`);
  console.log(`  Email:        ${email}`);
  console.log(`  Password:     ${password}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(
      "  (generated; re-running the seed sets a new one unless SEED_ADMIN_PASSWORD is set)",
    );
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
