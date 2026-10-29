// No "server-only" marker: the CV dispatcher (plain Node, src/worker/cv.ts)
// looks up reusable calibrations through this module.
import type { Prisma } from "@/generated/prisma/client";
import {
  fitHomography,
  HomographyError,
  invert,
  isMatrix3,
  landmarkById,
  multiply,
  type Matrix3,
} from "@/lib/homography";
import { distanceCovered, PITCH_LENGTH_M, PITCH_WIDTH_M } from "@/lib/positions";
import type { AuthContext } from "../auth/session";
import { rawDb } from "../db/raw";

/**
 * Pitch calibration (C09; CV05, Q-042). One homography per organisation,
 * venue and camera maps video pixels to pitch metres. A platform admin places
 * landmarks on a still in the Lab (saveManualCalibration); that calibration is
 * reused for later matches at the same venue and camera
 * (reusableCalibration, read by the CV dispatcher). Without one, the worker
 * guesses from the frame and ingest stores that fallback against the video
 * only; fallbacks are never reused.
 *
 * Saving re-projects the match's stored positions from the old homography to
 * the new one (H_new . H_old^-1), drops points that land off the pitch,
 * blanks event coordinates that do, and recomputes distance covered.
 */

export const STILL_AT_MS = 10_000;
export const MIN_POINTS = 4;
export const MAX_POINTS = 12;
export const MAX_REPROJECTION_ERROR_M = 1.5;
/** Points this far off the pitch are dropped; nearer ones are clamped onto it (as the worker). */
export const OFF_PITCH_MARGIN_M = 2;

/** When a CV attempt takes its still; cv_worker/wideline_cv/pipeline/core.py has the same rule. */
export function stillMs(durationMs: number): number {
  return Math.floor(Math.min(STILL_AT_MS, Math.floor(durationMs / 2)) / 200) * 200;
}

/** Match.venue normalised for reuse: trimmed, lower-cased, whitespace collapsed; blank is null. */
export function venueKey(venue: string | null | undefined): string | null {
  const key = (venue ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return key || null;
}

/** "{width}x{height}" of the probed video, or null when it was not probed. */
export function cameraKey(width: number | null, height: number | null): string | null {
  return width && height ? `${width}x${height}` : null;
}

export type StoredCalibration = { id: string; homography: Matrix3; confidence: number };

type Db = Prisma.TransactionClient | typeof rawDb;

/**
 * The current manual calibration for this venue and camera, or null. Only
 * manual calibrations are reused (A-7); a match without a venue never is.
 */
export async function reusableCalibration(
  db: Db,
  organisationId: string,
  venue: string | null,
  camera: string | null,
): Promise<StoredCalibration | null> {
  if (!venue || !camera) return null;
  const row = await db.pitchCalibration.findFirst({
    where: {
      organisationId,
      venueKey: venue,
      cameraKey: camera,
      source: "manual",
      supersededAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, homography: true, confidence: true },
  });
  if (!row || !isMatrix3(row.homography)) return null;
  return { id: row.id, homography: row.homography, confidence: row.confidence };
}

export type CalibrationPointInput = { landmark: string; x: number; y: number };

export type SaveCalibrationInput = {
  matchId: string;
  points: CalibrationPointInput[];
  /** The venue's current manual calibration when the page loaded (null for none). */
  expectedCurrentId: string | null;
};

export type CalibrationErrorCode =
  "not_found" | "too_few" | "too_many" | "fields" | "error_too_large" | "degenerate" | "changed";

export class CalibrationInputError extends Error {
  constructor(
    readonly code: CalibrationErrorCode,
    readonly fieldErrors: Record<string, string> = {},
    readonly errorM: number | null = null,
  ) {
    super(code);
  }
}

export type SavedCalibration = {
  id: string;
  errorM: number;
  pointsMoved: number;
  pointsDropped: number;
  eventsMoved: number;
  reprojected: boolean;
};

/** Checks the points against the image and the landmark list; field errors by "points.{i}.{field}". */
export function checkPoints(
  points: CalibrationPointInput[],
  width: number,
  height: number,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const used = new Map<string, number>();
  points.forEach((p, i) => {
    if (!p.landmark || !landmarkById(p.landmark)) {
      errors[`points.${i}.landmark`] = `Choose a landmark for point ${i + 1}.`;
    } else if (used.has(p.landmark)) {
      errors[`points.${i}.landmark`] = "Each landmark can be used once.";
    } else {
      used.set(p.landmark, i);
    }
    if (!Number.isFinite(p.x) || p.x < 0 || p.x > width) {
      errors[`points.${i}.x`] = `Enter a value from 0 to ${width}.`;
    }
    if (!Number.isFinite(p.y) || p.y < 0 || p.y > height) {
      errors[`points.${i}.y`] = `Enter a value from 0 to ${height}.`;
    }
  });
  return errors;
}

/**
 * Saves a manual calibration for the match's accepted video (platform admins
 * only; the Lab action checks the role). In one transaction: supersedes the
 * venue's current manual calibration, inserts the new one, links the video,
 * re-projects the match's stored positions and events, and audits
 * `pitch_calibration.saved` (ids and counts only).
 */
export async function saveManualCalibration(
  ctx: AuthContext,
  input: SaveCalibrationInput,
  now = new Date(),
): Promise<SavedCalibration> {
  const { organisationId } = ctx;
  if (input.points.length < MIN_POINTS) throw new CalibrationInputError("too_few");
  if (input.points.length > MAX_POINTS) throw new CalibrationInputError("too_many");

  return rawDb.$transaction(
    async (tx) => {
      const video = await tx.video.findFirst({
        where: { organisationId, matchId: input.matchId, status: "accepted" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          width: true,
          height: true,
          match: { select: { venue: true } },
          pitchCalibration: { select: { id: true, homography: true } },
        },
      });
      if (!video?.width || !video.height) throw new CalibrationInputError("not_found");
      const fields = checkPoints(input.points, video.width, video.height);
      if (Object.keys(fields).length) throw new CalibrationInputError("fields", fields);

      let fit: { homography: Matrix3; errorM: number };
      try {
        fit = fitHomography(
          input.points.map((p) => ({
            image: [p.x, p.y],
            pitch: landmarkById(p.landmark)!.pitch,
          })),
        );
      } catch (err) {
        if (err instanceof HomographyError) throw new CalibrationInputError("degenerate");
        throw err;
      }
      const errorM = Math.round(fit.errorM * 100) / 100;
      if (fit.errorM > MAX_REPROJECTION_ERROR_M) {
        throw new CalibrationInputError("error_too_large", {}, errorM);
      }

      const venue = venueKey(video.match.venue);
      const camera = cameraKey(video.width, video.height)!;
      if (venue) {
        // Serialise saves for one venue and camera, then check nobody saved since the page loaded.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${organisationId}|${venue}|${camera}`}))::text`;
        const current = await reusableCalibration(tx, organisationId, venue, camera);
        if ((current?.id ?? null) !== input.expectedCurrentId) {
          throw new CalibrationInputError("changed");
        }
        await tx.pitchCalibration.updateMany({
          where: {
            organisationId,
            venueKey: venue,
            cameraKey: camera,
            source: "manual",
            supersededAt: null,
          },
          data: { supersededAt: now },
        });
      }
      const created = await tx.pitchCalibration.create({
        data: {
          organisationId,
          venueKey: venue,
          cameraKey: camera,
          homography: fit.homography,
          imageWidth: video.width,
          imageHeight: video.height,
          confidence: Math.max(0, Math.min(1, 1 - fit.errorM / (2 * MAX_REPROJECTION_ERROR_M))),
          source: "manual",
          pointCount: input.points.length,
          reprojectionErrorM: errorM,
          sourceVideoId: video.id,
          calibratedByUserId: ctx.user.id,
        },
        select: { id: true },
      });
      await tx.video.updateMany({
        where: { id: video.id, organisationId },
        data: { pitchCalibrationId: created.id },
      });

      const old = video.pitchCalibration?.homography;
      const moved = isMatrix3(old)
        ? await reproject(tx, organisationId, input.matchId, multiply(fit.homography, invert(old)))
        : { pointsMoved: 0, pointsDropped: 0, eventsMoved: 0 };

      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: ctx.user.id,
          action: "pitch_calibration.saved",
          targetType: "PitchCalibration",
          targetId: created.id,
          metadata: {
            matchId: input.matchId,
            videoId: video.id,
            replacedId: video.pitchCalibration?.id ?? null,
            pointCount: input.points.length,
            errorM,
            ...moved,
          },
        },
      });
      return { id: created.id, errorM, reprojected: isMatrix3(old), ...moved };
    },
    { timeout: 5 * 60 * 1000, maxWait: 30_000 },
  );
}

/**
 * Moves the match's stored positions by M (old pitch metres to new): one
 * statement per table, then distance covered again for every track.
 */
export async function reproject(
  tx: Prisma.TransactionClient,
  organisationId: string,
  matchId: string,
  m: Matrix3,
): Promise<{ pointsMoved: number; pointsDropped: number; eventsMoved: number }> {
  const [[a, b, c], [d, e, f], [g, h, k]] = m;
  const lo = -OFF_PITCH_MARGIN_M;
  const hiX = PITCH_LENGTH_M + OFF_PITCH_MARGIN_M;
  const hiY = PITCH_WIDTH_M + OFF_PITCH_MARGIN_M;
  const pointsDropped = await tx.$executeRaw`
    DELETE FROM "TrackPoint" p
     USING (SELECT ${a}::float8 AS a, ${b}::float8 AS b, ${c}::float8 AS c,
                   ${d}::float8 AS d, ${e}::float8 AS e, ${f}::float8 AS f,
                   ${g}::float8 AS g, ${h}::float8 AS h, ${k}::float8 AS k) m
     WHERE p."organisationId" = ${organisationId} AND p."matchId" = ${matchId}
       AND NOT (
         (m.g * p.x + m.h * p.y + m.k) > 0
         AND (m.a * p.x + m.b * p.y + m.c) / (m.g * p.x + m.h * p.y + m.k) BETWEEN ${lo} AND ${hiX}
         AND (m.d * p.x + m.e * p.y + m.f) / (m.g * p.x + m.h * p.y + m.k) BETWEEN ${lo} AND ${hiY}
       )`;
  const pointsMoved = await tx.$executeRaw`
    UPDATE "TrackPoint" p
       SET x = LEAST(${PITCH_LENGTH_M}::float8, GREATEST(0::float8,
                 (${a}::float8 * p.x + ${b}::float8 * p.y + ${c}::float8)
                 / (${g}::float8 * p.x + ${h}::float8 * p.y + ${k}::float8)))::real,
           y = LEAST(${PITCH_WIDTH_M}::float8, GREATEST(0::float8,
                 (${d}::float8 * p.x + ${e}::float8 * p.y + ${f}::float8)
                 / (${g}::float8 * p.x + ${h}::float8 * p.y + ${k}::float8)))::real
     WHERE p."organisationId" = ${organisationId} AND p."matchId" = ${matchId}`;
  const eventsMoved = await tx.$executeRaw`
    UPDATE "Event" ev
       SET "pitchX" = CASE WHEN n.ok THEN LEAST(${PITCH_LENGTH_M}::float8, GREATEST(0::float8, n.x)) END,
           "pitchY" = CASE WHEN n.ok THEN LEAST(${PITCH_WIDTH_M}::float8, GREATEST(0::float8, n.y)) END
      FROM (
        SELECT e2."id",
               s.x, s.y,
               (s.w > 0 AND s.x BETWEEN ${lo} AND ${hiX} AND s.y BETWEEN ${lo} AND ${hiY}) AS ok
          FROM "Event" e2
          CROSS JOIN LATERAL (
            SELECT (${a}::float8 * e2."pitchX" + ${b}::float8 * e2."pitchY" + ${c}::float8)
                     / NULLIF(${g}::float8 * e2."pitchX" + ${h}::float8 * e2."pitchY" + ${k}::float8, 0) AS x,
                   (${d}::float8 * e2."pitchX" + ${e}::float8 * e2."pitchY" + ${f}::float8)
                     / NULLIF(${g}::float8 * e2."pitchX" + ${h}::float8 * e2."pitchY" + ${k}::float8, 0) AS y,
                   ${g}::float8 * e2."pitchX" + ${h}::float8 * e2."pitchY" + ${k}::float8 AS w
          ) s
         WHERE e2."organisationId" = ${organisationId} AND e2."matchId" = ${matchId}
           AND e2."jobId" IS NOT NULL AND e2."pitchX" IS NOT NULL AND e2."pitchY" IS NOT NULL
      ) n
     WHERE ev."id" = n."id"`;
  await recomputeDistances(tx, organisationId, matchId);
  return { pointsMoved, pointsDropped, eventsMoved };
}

/** Track.distanceM again from the stored points, for every track of the match. */
export async function recomputeDistances(
  tx: Prisma.TransactionClient,
  organisationId: string,
  matchId: string,
): Promise<void> {
  const tracks = await tx.track.findMany({
    where: { organisationId, matchId },
    select: { id: true },
  });
  for (const t of tracks) {
    const points = await tx.trackPoint.findMany({
      where: { organisationId, matchId, trackId: t.id },
      orderBy: { tMs: "asc" },
      select: { tMs: true, x: true, y: true },
    });
    await tx.track.updateMany({
      where: { id: t.id, organisationId },
      data: { distanceM: points.length ? distanceCovered(points) : null },
    });
  }
}
