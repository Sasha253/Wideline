import { randomUUID } from "node:crypto";
import type { MatchStatus, OrganisationStatus, OrganisationType } from "@/generated/prisma/enums";
import type { ReviewerContext } from "@/server/auth/reviewer";
import { rawDb } from "@/server/db/raw";
import { SCOUT_NETWORK_ORG_ID } from "@/server/scouts/network";
import type { fixtures } from "./fixtures";
import { scoutProfile } from "./scouts";

// Review fixtures for the C10 integration tests: an approved scout on the
// current terms as a ReviewerContext, and a club with a reviewable match (an
// accepted video with a raw footage expiry). Rows go with their organisation
// or user (cascade), so fixtures().cleanup() removes them.

const HOUR = 60 * 60 * 1000;

/** An approved scout on the current terms, as requireReviewer() would return them. */
export async function reviewer(
  f: ReturnType<typeof fixtures>,
  label: string,
): Promise<ReviewerContext> {
  const u = await f.user(`Reviewer ${label}`);
  const p = await scoutProfile(u.id, { status: "approved" });
  const ctx = await f.ctx(u, SCOUT_NETWORK_ORG_ID);
  return { ...ctx, scout: { id: p.id, status: p.status, termsVersion: p.termsVersion } };
}

export type ReviewMatchOptions = {
  /** Raw footage expiry from `now` (default 60 h). */
  expiresInMs?: number;
  now?: Date;
  status?: MatchStatus;
  orgStatus?: OrganisationStatus;
  orgType?: OrganisationType;
  /** An existing organisation instead of a new one. */
  organisationId?: string;
  homeName?: string;
  awayName?: string;
  /** Raw footage already deleted (clips only). */
  deleted?: boolean;
  /** An HLS manifest under the video's own prefix (for the playback routes). */
  hls?: boolean;
  /** pending_review events to create. */
  toCheck?: number;
};

/** A club match ready for review: teams, the match, an accepted video. */
export async function reviewMatch(
  f: ReturnType<typeof fixtures>,
  name: string,
  {
    expiresInMs = 60 * HOUR,
    now = new Date(),
    status = "awaiting_review",
    orgStatus = "active",
    orgType = "club",
    organisationId,
    homeName = `${name} U15`,
    awayName = "Visitors U15",
    deleted = false,
    hls = false,
    toCheck = 0,
  }: ReviewMatchOptions = {},
) {
  const orgId = organisationId ?? (await f.org(name, { status: orgStatus, type: orgType })).id;
  const [home, away] = await Promise.all([
    rawDb.team.create({
      data: { organisationId: orgId, name: homeName, season: "2026", ageGroup: "U15" },
    }),
    rawDb.team.create({
      data: { organisationId: orgId, name: awayName, season: "2026", isOpposition: true },
    }),
  ]);
  const match = await rawDb.match.create({
    data: {
      organisationId: orgId,
      homeTeamId: home.id,
      awayTeamId: away.id,
      playedAt: new Date("2026-10-18T10:00:00+02:00"),
      venue: `Secret venue ${randomUUID().slice(0, 4)}`,
      competition: "Pilot league",
      halfLengthMinutes: 35,
      status,
    },
  });
  const rawExpiresAt = new Date(now.getTime() + expiresInMs);
  const videoId = `vid-${randomUUID()}`;
  const prefix = `orgs/${orgId}/matches/${match.id}`;
  const video = await rawDb.video.create({
    data: {
      id: videoId,
      organisationId: orgId,
      matchId: match.id,
      status: "accepted",
      blobPath: `${prefix}/raw/${videoId}.mp4`,
      fileName: "match.mp4",
      contentType: "video/mp4",
      sizeBytes: BigInt(1000),
      partSize: 1000,
      fingerprint: randomUUID(),
      uploadedAt: new Date(rawExpiresAt.getTime() - 7 * 24 * HOUR),
      rawExpiresAt,
      deletedAt: deleted ? now : null,
      durationSec: 4200,
      hlsManifestPath: hls ? `${prefix}/hls/${videoId}/master.m3u8` : null,
    },
  });
  for (let i = 0; i < toCheck; i++) {
    await rawDb.event.create({
      data: {
        organisationId: orgId,
        matchId: match.id,
        type: "goal",
        status: "pending_review",
        timestampMs: 1000 * (i + 1),
      },
    });
  }
  return { organisationId: orgId, matchId: match.id, videoId: video.id, home, away, rawExpiresAt };
}

/** A guardian's grant for a player with no date of birth (a minor), written directly. */
export async function grantConsent(
  organisationId: string,
  playerId: string,
  state: "scout_visible" | "club_only",
  db: Pick<typeof rawDb, "consent"> = rawDb,
) {
  return db.consent.create({
    data: {
      organisationId,
      playerId,
      state,
      clubStats: true,
      scoutVisible: state === "scout_visible",
      grantedBy: "Thandi Guardian",
      relationship: "parent",
      method: "paper_form",
      wordingVersion: "test",
      playerWasMinor: true,
      grantedAt: new Date(),
    },
  });
}

/**
 * A named player in the match's home lineup. `consent` is the player's state:
 * scout_visible (the default: a reviewer may see the name, so the conflict
 * check reads it), club_only, or none (never asked).
 */
export async function lineupPlayer(
  m: Awaited<ReturnType<typeof reviewMatch>>,
  firstName: string,
  lastName: string,
  shirtNumber = 7,
  consent: "scout_visible" | "club_only" | "none" = "scout_visible",
) {
  const p = await rawDb.player.create({
    data: { organisationId: m.organisationId, teamId: m.home.id, firstName, lastName },
  });
  if (consent !== "none") await grantConsent(m.organisationId, p.id, consent);
  await rawDb.lineup.create({
    data: {
      organisationId: m.organisationId,
      matchId: m.matchId,
      teamId: m.home.id,
      playerId: p.id,
      shirtNumber,
    },
  });
  return p;
}

/** A declared affiliation, written directly. */
export async function affiliation(
  scoutUserId: string,
  data: {
    type: "club" | "player";
    name: string;
    clubName?: string;
    organisationId?: string;
    removedAt?: Date;
  },
) {
  return rawDb.scoutAffiliation.create({
    data: {
      scoutUserId,
      type: data.type,
      name: data.name,
      clubName: data.clubName ?? null,
      organisationId: data.organisationId ?? null,
      linkedAt: data.organisationId ? new Date() : null,
      removedAt: data.removedAt ?? null,
    },
  });
}

export const auditRows = (targetId: string, action: string) =>
  rawDb.auditLog.findMany({ where: { targetId, action }, orderBy: { createdAt: "asc" } });
