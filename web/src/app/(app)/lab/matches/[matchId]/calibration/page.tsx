import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { iconProps } from "@/components/ui/icons";
import { isMatrix3, type Matrix3 } from "@/lib/homography";
import { formatDate } from "@/lib/labels";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";
import { cameraKey, stillMs, venueKey } from "@/server/cv/calibration";
import { stillKeyFor } from "@/server/lab/benchmark";
import { bucket, s3Public } from "@/server/storage";
import { CalibrationTool } from "./CalibrationTool";

export const metadata = { title: "Pitch calibration" };

// The pitch calibration tool (docs/build/design/C09.md, Surface 4; CV05,
// Q-042): landmarks on a still from the latest CV attempt, fitted live, saved
// for the venue and camera, re-projecting this match's stored positions.

const STILL_URL_TTL_SEC = 15 * 60;

/** "Current: manual calibration, 0.8 m error from 6 points"; a missing value is left out. */
function manualSummary(errorM: number | null, points: number | null): string {
  const error = errorM !== null ? `${errorM.toFixed(1)} m error` : null;
  const from = points !== null ? `from ${points} points` : null;
  const detail = [error, from].filter(Boolean).join(" ");
  return detail ? `Current: manual calibration, ${detail}` : "Current: manual calibration";
}

export default async function CalibrationPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const ctx = await requirePageRole(LAB_ROLES);
  const { matchId } = await params;
  const match = await ctx.db.match.findFirst({
    where: { id: matchId },
    select: {
      id: true,
      venue: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });
  if (!match) notFound();
  const fixture = `${match.homeTeam.name} v ${match.awayTeam.name}`;
  const video = await ctx.db.video.findFirst({
    where: { matchId, status: "accepted" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      width: true,
      height: true,
      durationSec: true,
      pitchCalibration: {
        select: {
          id: true,
          source: true,
          homography: true,
          reprojectionErrorM: true,
          pointCount: true,
          createdAt: true,
        },
      },
    },
  });
  const cv = video
    ? await ctx.db.processingJob.findFirst({
        where: { videoId: video.id, type: "cv" },
        select: { id: true, attempts: true },
      })
    : null;
  const key = await stillKeyFor(ctx.organisationId, matchId, cv);

  const header = (
    <PageHeader
      back={{ href: `/lab/matches/${matchId}`, label: "Match benchmark" }}
      eyebrow={`CV Lab · ${fixture}`}
      title="Pitch calibration"
      intro="Place at least 4 pitch landmarks on the still. Spread them across the pitch: corners, box corners and the halfway line work best."
    />
  );
  if (!video?.width || !video.height || !key) {
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState
            art={false}
            title="No still yet"
            body="A still is saved from the footage each time the CV job runs. Run the job, then calibrate."
          />
        </div>
      </>
    );
  }

  const stillUrl = await getSignedUrl(
    s3Public(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: STILL_URL_TTL_SEC },
  );
  const venue = venueKey(match.venue);
  const camera = cameraKey(video.width, video.height);
  const currentManual = venue
    ? await ctx.db.pitchCalibration.findFirst({
        where: { venueKey: venue, cameraKey: camera!, source: "manual", supersededAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;
  const [points, events] = await Promise.all([
    ctx.db.trackPoint.count({ where: { matchId } }),
    ctx.db.event.count({ where: { matchId, jobId: { not: null }, pitchX: { not: null } } }),
  ]);
  const cal = video.pitchCalibration;
  const current = cal && isMatrix3(cal.homography) ? cal : null;

  return (
    <>
      {header}
      {current?.source === "manual" ? (
        <p className="body mt-4">
          {manualSummary(current.reprojectionErrorM, current.pointCount)}, saved{" "}
          {formatDate(current.createdAt)}.
        </p>
      ) : (
        <p className="body mt-4">
          <span className="wl-inline-status wl-inline-status--warn">
            <TriangleAlert {...iconProps} />
            Current: not calibrated. Positions are approximate.
          </span>
        </p>
      )}
      <p className="caption mt-1 text-ink-muted">
        {venue
          ? `Applies to later matches at ${match.venue} filmed at ${video.width} × ${video.height}.`
          : "This match has no venue, so later matches cannot reuse this calibration."}
      </p>
      <div className="mt-6">
        <CalibrationTool
          matchId={matchId}
          imageWidth={video.width}
          imageHeight={video.height}
          stillUrl={stillUrl}
          stillMs={stillMs(Math.round((video.durationSec ?? 0) * 1000))}
          current={
            current
              ? { homography: current.homography as Matrix3, manual: current.source === "manual" }
              : null
          }
          expectedCurrentId={currentManual?.id ?? null}
          venue={venue ? (match.venue ?? null) : null}
          storedPoints={points}
          storedEvents={events}
        />
      </div>
    </>
  );
}
