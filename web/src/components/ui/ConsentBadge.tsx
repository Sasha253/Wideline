import { Clock, Shield, ShieldCheck, ShieldHalf, ShieldOff, type LucideIcon } from "lucide-react";
import type { ConsentState } from "@/generated/prisma/enums";
import { cx } from "./cx";
import { iconProps } from "./icons";

/** The Floodlight consent states (docs/design-handoff/README.md, "ConsentBadge"). */
export type ConsentBadgeState = "given" | "awaiting" | "withdrawn" | "none";

type ConsentLook = {
  /** Chip tone class: solid confirmed, dashed pending, rejected-subtle, thin outline. */
  tone: "ok" | "ok-subtle" | "warn" | "danger" | "neutral";
  icon: LucideIcon;
  /** Badge M, the tooltip and accessible name of the icon-only form. */
  label: string;
  /** Badge S (tables) and the dated form. */
  short: string;
};

// Four different shield icons, so the states can be told apart without colour, even in
// the icon-only table form. Withdrawn uses the rejected colour but is never struck through.
const LOOK: Record<ConsentBadgeState | "club_only", ConsentLook> = {
  given: { tone: "ok", icon: ShieldCheck, label: "Consent given", short: "Given" },
  awaiting: { tone: "warn", icon: Clock, label: "Awaiting consent", short: "Awaiting" },
  withdrawn: { tone: "danger", icon: ShieldOff, label: "Consent withdrawn", short: "Withdrawn" },
  none: { tone: "neutral", icon: Shield, label: "Not requested", short: "Not requested" },
  // Not in the design: the guardian said yes to the club and no to scouts. Settled, so a
  // confirmed-subtle fill, with its own half shield.
  club_only: { tone: "ok-subtle", icon: ShieldHalf, label: "Club only", short: "Club only" },
};

/** Maps the stored consent state (Prisma) onto the badge states. */
export function consentBadgeState(
  state: ConsentState | ConsentBadgeState,
): ConsentBadgeState | "club_only" {
  switch (state) {
    case "scout_visible":
      return "given";
    case "requested":
      return "awaiting";
    default:
      return state;
  }
}

/**
 * Whether scouts can see a player, for club staff only: squad, lineup, dashboard gaps
 * and profile heroes. Never render it for scouts: they only ever see players with
 * consent given, so the badge adds nothing.
 *
 * - size m (26px) by default, s (20px) in tables.
 * - date: the dated form for profile heroes, "Given · 2 Sep 2026" (pass "2 Sep 2026",
 *   or "sent 28 Oct 2026" for awaiting).
 * - iconOnly: the bare 20px shield for dense tables, with the label as tooltip and
 *   accessible name.
 */
export function ConsentBadge({
  state,
  size = "m",
  date,
  iconOnly = false,
  className,
}: {
  state: ConsentState | ConsentBadgeState;
  size?: "m" | "s";
  date?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const key = consentBadgeState(state);
  const { tone, icon: Icon, label, short } = LOOK[key];
  if (iconOnly) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cx("wl-consent-icon", `wl-consent-icon--${tone}`, className)}
      >
        <Icon {...iconProps} />
      </span>
    );
  }
  if (date) {
    return (
      <span className={cx("wl-consent-dated", `wl-consent-icon--${tone}`, className)}>
        <Icon {...iconProps} />
        <span className="wl-consent-dated__state">{short}</span>
        <span className="sr-only"> · </span>
        <span className="wl-consent-dated__date">{date}</span>
      </span>
    );
  }
  return (
    <span className={cx("wl-chip", `wl-chip--${tone}`, size === "s" && "wl-chip--s", className)}>
      <Icon {...iconProps} />
      {size === "s" ? short : label}
    </span>
  );
}
