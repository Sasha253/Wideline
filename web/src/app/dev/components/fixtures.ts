import type { PlayerPosition } from "@/components/ui/PitchHeatmap";
import type { PlayerStat } from "@/components/ui/PlayerCard";

// Deterministic sample data for the component gallery. Copy comes from the
// design-system README and component previews. Nothing here is tenant data.

const HOUR = 60 * 60 * 1000;

/** A fixed clock (a Wednesday), so the expiry examples never drift. */
export const now = new Date("2025-10-22T10:00:00+02:00");
/** Friday 24 Oct, 10:00: the warning level. */
export const warningExpiry = new Date(now.getTime() + 48 * HOUR);
/** Six hours away: the danger level. */
export const dangerExpiry = new Date(now.getTime() + 6 * HOUR);

export const HOME_TEAM = "Orlando Pirates U17";
export const AWAY_TEAM = "SuperSport Academy U17";

// Shares that bucket to the same heat levels as PitchHeatmap/preview.html
// (0.01 → h1, 0.03 → h2, 0.05 → h3, 0.07 → h4, 0.09 → h5; 0 draws no zone).
export const heatmapZones: number[][] = [
  [0.01, 0.01, 0.03, 0.03, 0.05, 0.03],
  [0.01, 0.03, 0.05, 0.07, 0.09, 0.07],
  [0.01, 0.03, 0.05, 0.05, 0.07, 0.05],
  [0, 0.01, 0.01, 0.03, 0.03, 0.01],
];

export const averagePositions: PlayerPosition[] = [
  { side: "home", label: "7", x: 78, y: 22 },
  { side: "home", label: "4", x: 30, y: 40 },
  { side: "home", label: "10", x: 60, y: 30 },
  { side: "away", label: "9", x: 40, y: 34 },
  { side: "away", label: "5", x: 85, y: 28 },
  { side: "away", label: "8", x: 62, y: 48 },
];

export const thaboStats: PlayerStat[] = [
  { label: "Matches", value: "14" },
  { label: "Goals per 90", value: "0.62" },
  { label: "Shots per 90", value: "2.1" },
  { label: "Distance", value: "8.4 km" },
];

// Five stats on purpose: the card shows only the first four.
export const siphoStats: PlayerStat[] = [
  { label: "Matches", value: "11" },
  { label: "Tackles per 90", value: "3.4" },
  { label: "Interceptions per 90", value: "2.2" },
  { label: "Distance", value: "9.1 km" },
  { label: "Headers won", value: "61%" },
];

export const leboStats: PlayerStat[] = [
  { label: "Matches", value: "6" },
  { label: "Passes per 90", value: "48" },
  { label: "Chances created per 90", value: "1.3" },
  { label: "Distance", value: "10.2 km" },
];
