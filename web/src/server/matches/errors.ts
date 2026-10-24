// Errors for the matches module and the copy they carry (docs/build/design/C06.md).

export type MatchErrorCode =
  | "not_found"
  | "invalid"
  | "locked"
  | "team_in_use"
  | "player_unavailable"
  | "not_on_pitch"
  | "already_on"
  | "later_substitution"
  | "upload_type"
  | "upload_empty"
  | "upload_too_big"
  | "upload_exists"
  | "upload_gone"
  | "missing_parts"
  | "no_footage";

/**
 * A refusal the user can act on. userMessage and field place the copy on the
 * form; fieldErrors carries several at once (lineup rows). detail holds data
 * the route handlers return as JSON (missing part numbers).
 */
export class MatchError extends Error {
  constructor(
    readonly code: MatchErrorCode,
    readonly userMessage?: string,
    readonly field?: string,
    readonly fieldErrors?: Record<string, string>,
    readonly detail?: Record<string, unknown>,
  ) {
    super(`Match: ${code}`);
    this.name = "MatchError";
  }
}

export const MATCH_GONE = "This match no longer exists. Go back to Matches.";
export const PLAYERS_UNAVAILABLE =
  "Some players can no longer be picked. Reload the page and try again.";
export const CHOOSE_FROM_LIST = "Choose a team from the list.";
export const ONE_SIDE_OWN = "One side must be one of your teams.";

/** "Lineups are locked while this match is in review." / "... because this match is published." */
export function lockedMessage(what: "Lineups" | "Markers", status: "in_review" | "published") {
  return status === "published"
    ? `${what} are locked because this match is published.`
    : `${what} are locked while this match is in review.`;
}
