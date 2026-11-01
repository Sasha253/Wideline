import { Lock } from "lucide-react";
import { iconProps } from "@/components/ui/icons";

/** The reason line's second sentence. It never says which club or player, or why (A-8). */
export const CONFLICT_REASON = "You are linked to a club or player in it.";

/**
 * The reason on a locked queue row (Floodlight, Screens B "Review queue"; REVIEW02,
 * AUTH10): a lock, then the sentence. Text, not a control: the row's Locked button points
 * at it with `aria-describedby` (pass `id`). The match stays in the list so the queue
 * never looks shorter than it is.
 */
export function ConflictNote({ id }: { id?: string }) {
  return (
    <span id={id} className="flex items-start gap-1.5 text-body-s text-ink-muted">
      <Lock {...iconProps} size={14} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-semibold text-ink">You cannot claim this match.</span>{" "}
        {CONFLICT_REASON}
      </span>
    </span>
  );
}
