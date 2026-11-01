import type { PitchSpot } from "@/components/ui/MiniPitch";
import type { PlayerPosition } from "@/components/ui/PitchHeatmap";
import type { PlayerFigure } from "@/components/ui/PlayerCard";
import type { InvitationState } from "@/components/ui/StatusChip";
import type { ClubStatus, OrganisationStatus, ScoutStatus } from "@/generated/prisma/enums";

// Deterministic sample data for the component gallery. Copy comes from the Floodlight
// design files (Wideline Components and Wideline Patterns). Nothing here is tenant data.

const HOUR = 60 * 60 * 1000;

/** A fixed clock (a Wednesday), so the expiry examples never drift. */
export const now = new Date("2026-10-28T10:00:00+02:00");

/** Expiry examples for the four steps: hours from `now`. */
export const hoursFromNow = (h: number) => new Date(now.getTime() + h * HOUR);
/** More than 3 days: neutral. */
export const neutralExpiry = hoursFromNow(5 * 24 + 4);
/** 3 days or less: pending. */
export const pendingExpiry = hoursFromNow(46);
/** Under 24 hours: urgent. */
export const urgentExpiry = hoursFromNow(6);

export const HOME_TEAM = "Orlando Pirates U17";
export const AWAY_TEAM = "SuperSport Academy U17";

/**
 * A 10 × 16 heatmap (rows from the top touchline, columns from the own goal), as shares
 * of minutes: most time in central midfield and the left half-space, attacking left to
 * right. Built from a smooth bump, so it is the same on every render.
 */
export const heatmapZones: number[][] = Array.from({ length: 10 }, (_, r) =>
  Array.from({ length: 16 }, (_, c) => {
    const main = Math.exp(-((r - 3.5) ** 2) / 5 - (c - 9) ** 2 / 9);
    const box = Math.exp(-((r - 4.5) ** 2) / 3 - (c - 13) ** 2 / 2) * 0.6;
    return Number((0.09 * Math.max(main, box)).toFixed(3));
  }),
);

/** A thin sample: under 3 matches. */
export const thinZones: number[][] = heatmapZones.map((row) => row.map((v) => (v > 0.04 ? v : 0)));

export const averagePositions: PlayerPosition[] = [
  { side: "home", label: "7", x: 78, y: 22 },
  { side: "home", label: "4", x: 30, y: 40 },
  { side: "home", label: "10", x: 60, y: 30 },
  { side: "away", label: "9", x: 40, y: 34 },
  { side: "away", label: "5", x: 85, y: 28 },
  { side: "away", label: "8", x: 62, y: 48 },
];

/** The usual position (metres: 0–105 along, 0–68 across) and the others played. */
export const usualSpot: PitchSpot = { x: 70, y: 14, label: "Left wing" };
export const alsoSpots: PitchSpot[] = [
  { x: 62, y: 34, label: "Attacking midfield" },
  { x: 84, y: 30, label: "Striker" },
];

export const thaboFigures: PlayerFigure[] = [
  { label: "Goals", value: "0.62", unit: "per 90" },
  { label: "Shots", value: "2.06", unit: "per 90" },
  { label: "Distance", value: "9.1", unit: "km" },
];

export const siphoFigures: PlayerFigure[] = [
  { label: "Tackles", value: "3.4", unit: "per 90" },
  { label: "Interceptions", value: "2.2", unit: "per 90" },
  { label: "Distance", value: "10.2", unit: "km" },
];

// Chip presets, in the order of docs/build/design/C01.md (Surface 8).
export const INVITATION_STATE_FIXTURES: InvitationState[] = [
  "pending",
  "expired",
  "accepted",
  "revoked",
];
export const ORGANISATION_STATE_FIXTURES: OrganisationStatus[] = [
  "pending",
  "active",
  "rejected",
  "suspended",
];
export const SCOUT_STATE_FIXTURES: ScoutStatus[] = ["pending", "approved", "suspended", "rejected"];
// C04: current players carry no chip, so only Departed shows (docs/build/design/C04.md).
export const CLUB_STATE_FIXTURES: ClubStatus[] = ["departed"];
