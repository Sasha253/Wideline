/**
 * Local seed: the Wideline Lab platform organisation, one platform admin with a
 * password, two teams of 11 placeholder players, and one match with both
 * lineups. A second active demo club, with the admin as owner, lets the
 * organisation switch (AUTH05) work locally and in e2e. The scout network
 * organisation ("Wideline scouts", AUTH08) is created too. All three run on the
 * pilot plan (BILL02). Safe to re-run.
 *
 * Players are shirt-number placeholders, not named people, so the Lab never
 * derives per-player data about a named, non-consented child (NFR-08).
 * "Opposition U17" is an opposition team (Team.isOpposition, SQUAD07).
 *
 * C09: a second Lab match, "Benchmark", carries the synthetic scene's ground
 * truth (tests/fixtures/cv/synthetic-truth.csv) as tags, so the Lab shows
 * recall once footage is uploaded to it and the synthetic CV run finishes.
 */
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { rawDb as db } from "../src/server/db/raw";
import { ensurePilotPlan, ensureSubscription } from "../src/server/entitlements/plans";
import { parseTagsCsv } from "../src/server/lab/tags";
import { ensureScoutNetwork, SCOUT_NETWORK_NAME } from "../src/server/scouts/network";

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

  // Independent scouts get their scout membership here (src/server/scouts/network.ts).
  await ensureScoutNetwork(db);

  // Every organisation runs on the pilot plan (src/server/entitlements/plans.ts).
  await ensurePilotPlan(db);
  await ensureSubscription(db, org.id);
  await ensureSubscription(db, demo.id);

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
          data: {
            organisationId: org.id,
            name,
            ageGroup: "U17",
            season,
            isOpposition: name === "Opposition U17",
          },
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

  // C09: the Lab benchmark match and its synthetic ground-truth tags.
  const benchmark = await db.match.findFirst({
    where: { organisationId: org.id, competition: "Benchmark" },
  });
  const [labHome, labAway] = await Promise.all(
    ["Lab Academy U17", "Opposition U17"].map((name) =>
      db.team.findFirst({ where: { organisationId: org.id, name } }),
    ),
  );
  if (!benchmark && labHome && labAway) {
    const created = await db.match.create({
      data: {
        organisationId: org.id,
        homeTeamId: labHome.id,
        awayTeamId: labAway.id,
        playedAt: new Date("2026-10-25T10:00:00+02:00"),
        venue: "Lab Training Ground",
        competition: "Benchmark",
      },
    });
    const csv = readFileSync(
      join(import.meta.dirname, "../tests/fixtures/cv/synthetic-truth.csv"),
      "utf8",
    );
    const parsed = parseTagsCsv(csv, null);
    if (parsed.ok) {
      const importBatchId = randomUUID();
      await db.benchmarkTag.createMany({
        data: parsed.rows.map((r) => ({
          organisationId: org.id,
          matchId: created.id,
          type: r.type,
          timestampMs: r.timestampMs,
          teamSide: r.teamSide,
          onTarget: r.onTarget,
          source: "synthetic" as const,
          importBatchId,
        })),
      });
    }
  }

  // Opposition teams hold unnamed placeholders only (SQUAD07). Marks the Lab's
  // opposition on databases seeded before C04 too.
  await db.team.updateMany({
    where: { organisationId: org.id, name: "Opposition U17", isOpposition: false },
    data: { isOpposition: true },
  });

  console.log("\nSeed complete.");
  console.log(
    `  Organisations: ${org.name} (platform admin), ${demo.name} (owner), ${SCOUT_NETWORK_NAME} (scouts)`,
  );
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
