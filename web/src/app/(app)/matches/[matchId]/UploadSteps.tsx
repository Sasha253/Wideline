import { StepHeader, type StepItem } from "@/components/ui/StepHeader";
import { formatSize } from "@/lib/labels";
import { MARKER_KEYS } from "@/lib/match-clock";
import type { MatchDetail } from "@/server/matches/matches";

/**
 * The three upload steps over the upload, lineup and marker pages (Floodlight Screens A,
 * "Upload"): Recording, Lineup, Markers. Each disc says where that step is, worked out
 * from the match: the upload carries on in the background ("busy"), the lineup and the
 * markers are done once the club has entered them. Processing starts when all three are.
 */
export function UploadSteps({ match, current }: { match: MatchDetail; current: 1 | 2 | 3 }) {
  const video = match.video && match.video.status !== "cancelled" ? match.video : null;
  const accepted = video?.status === "accepted";
  const uploading = video?.status === "uploading" || video?.status === "probing";

  const own = (["home", "away"] as const).filter(
    (s) => !(s === "home" ? match.homeTeam : match.awayTeam).isOpposition,
  );
  const lineupDone =
    own.length > 0 &&
    own.every((s) => match.lineups[s].starters + match.lineups[s].substitutes > 0);
  const lineupSub = (["home", "away"] as const)
    .map((s) => match.lineups[s])
    .filter((c) => c.starters + c.substitutes > 0)
    .map((c) => `${c.starters} + ${c.substitutes}`)
    .join(" · ");
  const markersSet = video ? MARKER_KEYS.filter((k) => video.markers[k] !== null).length : 0;

  const steps: StepItem[] = [
    {
      label: "Recording",
      sub: accepted
        ? `${formatSize(video.sizeBytes)} · uploaded`
        : uploading
          ? video?.status === "probing"
            ? "Checking footage"
            : "Uploading"
          : "Not uploaded yet",
      state: current === 1 ? undefined : accepted ? "done" : uploading ? "busy" : "waiting",
    },
    {
      label: "Lineup",
      sub: lineupSub || "Home and away",
      state: current === 2 ? undefined : lineupDone ? "done" : "waiting",
    },
    {
      label: "Markers",
      sub:
        markersSet > 0
          ? `${markersSet} of ${MARKER_KEYS.length} set`
          : "Kickoff, half-time, full time",
      state: current === 3 ? undefined : markersSet === MARKER_KEYS.length ? "done" : "waiting",
    },
  ];

  return <StepHeader steps={steps} current={current} label="Upload steps" className="mt-5" />;
}
