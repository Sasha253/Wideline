import type { MatchStatus } from "@/generated/prisma/enums";

/**
 * Match status moves made by C06 (MATCH07). Draft and Uploading go back and
 * forth (an upload starts, is cancelled or rejected); accepted footage moves
 * Uploading to Processing. C07 to C12 own the later moves.
 */
export const C06_TRANSITIONS: Partial<Record<MatchStatus, readonly MatchStatus[]>> = {
  draft: ["uploading"],
  uploading: ["draft", "processing"],
};

export function canMove(from: MatchStatus, to: MatchStatus): boolean {
  return C06_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The statuses a move to `to` may start from, for a guarded updateMany. */
export function fromStatusesFor(to: MatchStatus): MatchStatus[] {
  return (Object.keys(C06_TRANSITIONS) as MatchStatus[]).filter((from) => canMove(from, to));
}
