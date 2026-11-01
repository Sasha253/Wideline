import { notFound } from "next/navigation";
import { Banner } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { isLocked, requireSquadOrgPage } from "@/server/matches/access";
import { lockedMessage } from "@/server/matches/errors";
import { signedRawUrl } from "@/server/matches/markers";
import { playableVideo } from "@/server/matches/playback";
import { loadMatch } from "../load";
import { StepFooter } from "../StepFooter";
import { UploadStrip } from "../upload/UploadStrip";
import { UploadSteps } from "../UploadSteps";
import { MarkerTool } from "./MarkerTool";

export const metadata = { title: "Kickoff and half-time" };

const CONTENT_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime" };

/**
 * The kickoff and half-time marker tool (MATCH05; docs/build/design/C06.md,
 * Surface 5). Needs accepted footage; locked once the match is in review.
 * C07: plays HLS once the transcode is ready, the raw file until then.
 */
export default async function MarkersPage({ params }: { params: Promise<{ matchId: string }> }) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const match = await loadMatch(ctx, (await params).matchId);
  if (!match) notFound();
  const video = match.video?.status === "accepted" && !match.video.deletedAt ? match.video : null;
  const locked = isLocked(match.status);
  const ext = video?.fileName.split(".").pop()?.toLowerCase() ?? "mp4";
  const hlsReady = !!video && !!(await playableVideo(ctx, match.id));
  const raw = video && !hlsReady ? await signedRawUrl(ctx, match.id) : null;

  return (
    <>
      <UploadStrip matchId={match.id} />
      <PageHeader
        back={{ href: `/matches/${match.id}`, label: "Match" }}
        eyebrow="Step 3 of 3 · Markers"
        title="Kickoff and half-time"
        intro="Mark four moments in the video, so video time maps to match minutes."
      >
        <UploadSteps match={match} current={3} />
      </PageHeader>
      {!video ? (
        <div className="mt-6">
          <EmptyState
            art={false}
            title="Upload footage first"
            body="You can mark kickoff and half-time once the footage is accepted."
            action={
              match.status === "draft" ? (
                <ButtonLink variant="primary" href={`/matches/${match.id}/upload`}>
                  Upload footage
                </ButtonLink>
              ) : (
                <ButtonLink variant="primary" href={`/matches/${match.id}`}>
                  Back to match
                </ButtonLink>
              )
            }
          />
        </div>
      ) : (
        <>
          {locked && (
            <div className="mt-6">
              <Banner tone="warn">
                {lockedMessage("Markers", match.status as "in_review" | "published")}
              </Banner>
            </div>
          )}
          <MarkerTool
            matchId={match.id}
            hlsUrl={hlsReady ? `/api/matches/${match.id}/hls/master.m3u8` : null}
            fileUrl={raw?.url ?? null}
            contentType={CONTENT_TYPES[ext] ?? "video/mp4"}
            halfLengthMinutes={match.halfLengthMinutes}
            initial={video.markers}
            locked={locked}
            durationMs={video.durationSec !== null ? Math.round(video.durationSec * 1000) : 0}
          />
          {!locked && (
            <StepFooter
              id="markers-step"
              back={{ href: `/matches/${match.id}/lineup`, label: "Lineup" }}
              next={{
                label: "Finish and process",
                // Enabled once full time is saved; processing then runs on its own.
                href: video.markers.fullTimeMs !== null ? `/matches/${match.id}` : null,
                reason: "Set full time to continue",
              }}
            />
          )}
        </>
      )}
    </>
  );
}
