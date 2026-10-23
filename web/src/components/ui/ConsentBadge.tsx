import { Hourglass, Shield, ShieldCheck, ShieldOff, type LucideIcon } from "lucide-react";
import type { ConsentState } from "@/generated/prisma/enums";
import { iconProps } from "./icons";

const CONSENT: Record<
  ConsentState,
  { tone: "ok" | "neutral" | "warn" | "danger"; icon?: LucideIcon; label: string }
> = {
  scout_visible: { tone: "ok", icon: ShieldCheck, label: "Scout-visible" },
  club_only: { tone: "neutral", icon: Shield, label: "Club only" },
  requested: { tone: "warn", icon: Hourglass, label: "Requested" },
  withdrawn: { tone: "danger", icon: ShieldOff, label: "Withdrawn" },
  // The README pairs "No consent" with no icon; the word carries the meaning.
  none: { tone: "neutral", label: "No consent" },
};

/**
 * A player's consent state, for club staff on player rows, cards and profile
 * heroes. Never render this badge for scouts: they only ever see scout-visible
 * players. Callers pass it in club views only.
 */
export function ConsentBadge({ state }: { state: ConsentState }) {
  const { tone, icon: Icon, label } = CONSENT[state];
  return (
    <span className={`wl-chip wl-chip--${tone}`}>
      {Icon && <Icon {...iconProps} />}
      {label}
    </span>
  );
}
