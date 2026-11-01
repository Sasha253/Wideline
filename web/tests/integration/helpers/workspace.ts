import { randomUUID } from "node:crypto";
import type { EventStatus, EventType, TeamSide } from "@/generated/prisma/enums";
import type { ReviewerContext } from "@/server/auth/reviewer";
import { rawDb } from "@/server/db/raw";
import { claimMatch } from "@/server/review/claims";
import { claimScope, type ClaimScope } from "@/server/review/scope";
import type { fixtures } from "./fixtures";
import { grantConsent, reviewer, reviewMatch, type ReviewMatchOptions } from "./review";

// C11 fixtures for the review workspace tests: a claimed match with a
// succeeded cv job (and its Q-041 side evidence), lineup players on either
// side in any consent state, tracks and CV events written directly, and the
// scout's ClaimScope.

type Fixtures = ReturnType<typeof fixtures>;
export type WorkspaceMatch = Awaited<ReturnType<typeof reviewMatch>> & { jobId: string };

/** A reviewable match with a succeeded cv job. Evidence {0, 0} leaves the sides unconfirmed. */
export async function workspaceMatch(
  f: Fixtures,
  name: string,
  {
    evidence = { kept: 0, swapped: 0 },
    ...opts
  }: ReviewMatchOptions & { evidence?: { kept: number; swapped: number } } = {},
): Promise<WorkspaceMatch> {
  const m = await reviewMatch(f, name, opts);
  const job = await rawDb.processingJob.create({
    data: {
      organisationId: m.organisationId,
      matchId: m.matchId,
      videoId: m.videoId,
      type: "cv",
      status: "succeeded",
      bossJobId: randomUUID(),
      attempts: 1,
      finishedAt: new Date(),
      metadata: { teamSideEvidence: evidence, teamSideSwapped: false },
    },
  });
  return { ...m, jobId: job.id };
}

/**
 * A named lineup player on `side`, in a consent state (none: never asked).
 * The away team is the opposition, whose players can hold no consent.
 */
export async function sidePlayer(
  m: WorkspaceMatch,
  side: "home" | "away",
  shirtNumber: number,
  consent: "scout_visible" | "club_only" | "none",
  { firstName = `First${shirtNumber}`, lastName = `Last${side}`, placeholder = false } = {},
) {
  const team = side === "home" ? m.home : m.away;
  const p = await rawDb.player.create({
    data: {
      organisationId: m.organisationId,
      teamId: team.id,
      firstName: placeholder ? null : firstName,
      lastName: placeholder ? null : lastName,
      isPlaceholder: placeholder,
    },
  });
  if (consent !== "none") await grantConsent(m.organisationId, p.id, consent);
  const entry = await rawDb.lineup.create({
    data: {
      organisationId: m.organisationId,
      matchId: m.matchId,
      teamId: team.id,
      playerId: p.id,
      shirtNumber,
    },
  });
  return { playerId: p.id, entryId: entry.id };
}

let trackSeq = 0;

export async function track(
  m: WorkspaceMatch,
  { side = "home", playerId = null }: { side?: TeamSide; playerId?: string | null } = {},
) {
  trackSeq += 1;
  return rawDb.track.create({
    data: {
      organisationId: m.organisationId,
      matchId: m.matchId,
      jobId: m.jobId,
      trackIndex: trackSeq,
      teamSide: side,
      playerId,
      linkedBy: playerId ? "cv" : null,
    },
  });
}

/** A TrackPoint on the track, so a discard can be seen to cascade. */
export async function trackPoint(m: WorkspaceMatch, trackId: string, tMs = 1000) {
  await rawDb.$executeRaw`
    INSERT INTO "TrackPoint" ("organisationId", "matchId", "trackId", "tMs", "x", "y")
    VALUES (${m.organisationId}, ${m.matchId}, ${trackId}, ${tMs}, 10, 10)`;
}

let eventSeq = 0;

export async function cvEvent(
  m: WorkspaceMatch,
  {
    type = "shot",
    status = "pending_review",
    side = "home",
    trackId = null,
    playerId = null,
    timestampMs,
    confidence = 0.6,
  }: {
    type?: EventType;
    status?: EventStatus;
    side?: TeamSide | null;
    trackId?: string | null;
    playerId?: string | null;
    timestampMs?: number;
    confidence?: number;
  } = {},
) {
  eventSeq += 1;
  const t = timestampMs ?? 60_000 + eventSeq * 1000;
  return rawDb.event.create({
    data: {
      organisationId: m.organisationId,
      matchId: m.matchId,
      jobId: m.jobId,
      sourceKey: `${type}@${t}#${eventSeq}`,
      type,
      status,
      teamSide: side,
      trackId,
      playerId,
      timestampMs: t,
      pitchX: 50,
      pitchY: 30,
      confidence,
      clipStartMs: Math.max(0, t - 5000),
      clipEndMs: t + 5000,
    },
  });
}

/** The scout's claim on the match, and its scope. */
export async function claimed(
  f: Fixtures,
  m: WorkspaceMatch,
  label: string,
): Promise<{ scout: ReviewerContext; claimId: string; scope: ClaimScope }> {
  const scout = await reviewer(f, label);
  const { claimId } = await claimMatch(scout, m.matchId, { declaration: true });
  const scope = await claimScope(scout, claimId);
  if (!scope) throw new Error("no claim scope");
  return { scout, claimId, scope };
}

export const corrections = (eventId: string) =>
  rawDb.eventCorrection.findMany({ where: { eventId }, orderBy: { correctedAt: "asc" } });
