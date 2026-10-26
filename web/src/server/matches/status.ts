import type { MatchStatus } from "@/generated/prisma/enums";

/**
 * Match status moves (MATCH07). C06: Draft and Uploading go back and forth (an
 * upload starts, is cancelled or rejected); accepted footage moves Uploading
 * to Processing. C07: a transcode that fails its last attempt moves
 * Processing to Failed (NFR30). C08 to C12 own the later moves.
 */
export const MATCH_TRANSITIONS: Partial<Record<MatchStatus, readonly MatchStatus[]>> = {
  draft: ["uploading"],
  uploading: ["draft", "processing"],
  processing: ["failed"],
};

export function canMove(from: MatchStatus, to: MatchStatus): boolean {
  return MATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The statuses a move to `to` may start from, for a guarded updateMany. */
export function fromStatusesFor(to: MatchStatus): MatchStatus[] {
  return (Object.keys(MATCH_TRANSITIONS) as MatchStatus[]).filter((from) => canMove(from, to));
}
