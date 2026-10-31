import { ShieldOff } from "lucide-react";
import { iconProps } from "@/components/ui/icons";

/**
 * Shown in place of the Claim button on a conflicted row (REVIEW02, AUTH10;
 * docs/build/design/C10.md, "Conflict note"). Text, not a control. It never
 * says which club or player, or why (A-8).
 */
export function ConflictNote() {
  return (
    <span className="block">
      <span className="wl-inline-status wl-inline-status--muted caption">
        <ShieldOff {...iconProps} />
        <span className="body-strong">You cannot claim this match</span>
      </span>
      <span className="caption block text-ink-muted">
        You are linked to a club or player in it.
      </span>
    </span>
  );
}
