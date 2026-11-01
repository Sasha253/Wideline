import { CircleAlert, User } from "lucide-react";
import { cx } from "./cx";
import { iconProps } from "./icons";

/** Under this the meter turns pending and adds the word "Low": the scout looks there first. */
export const LOW_CONFIDENCE = 0.5;

const SEGMENTS = 10;

/**
 * How sure the model is about a detected event, from 0 to 1 (Floodlight, "ConfidenceMeter").
 * Ten segments give a quick read when scanning; the number, always to two decimals, is
 * the fact. Below 0.50 the meter turns pending and adds "Low". Events a person created
 * show "Added by scout" instead of a meter.
 *
 * - size inline: review event rows. size large: the selected-event panel.
 * - Review only. Never on player profiles or to clubs: confirmed stats are facts.
 * - No percentages, stars or words like "great".
 */
export function ConfidenceMeter({
  value,
  score,
  size = "inline",
  manual = false,
  addedBy,
  addedAt,
  className,
}: {
  /** 0 to 1. Clamped before display. */
  value?: number;
  /** @deprecated Use `value`. */
  score?: number;
  size?: "inline" | "large";
  /** An event a person added: no model score. */
  manual?: boolean;
  /** Large manual form: "Added by Nomvula Mthembu at 31:40". */
  addedBy?: string;
  addedAt?: string;
  /**
   * @deprecated Floodlight marks every score under 0.50 as low, whatever the event type's
   * auto-accept threshold. Ignored.
   */
  threshold?: number;
  /** @deprecated Use size="large". Ignored: the inline meter now always says "Low". */
  detail?: boolean;
  className?: string;
}) {
  const large = size === "large";
  const raw = value ?? score;

  if (manual || raw === undefined) {
    const who = addedBy
      ? `Added by ${addedBy}${addedAt ? ` at ${addedAt}` : ""}`
      : "Added by scout";
    return (
      <span className={cx("wl-conf", "wl-conf--manual", large && "wl-conf--large", className)}>
        {large && <span className="wl-conf__label">Model confidence</span>}
        <span className="wl-conf__manual">
          {!large && <User {...iconProps} />}
          {who}
        </span>
      </span>
    );
  }

  const v = Math.min(1, Math.max(0, raw));
  const low = v < LOW_CONFIDENCE;
  const filled = Math.round(v * SEGMENTS);
  return (
    <span className={cx("wl-conf", low && "wl-conf--low", large && "wl-conf--large", className)}>
      {large && <span className="wl-conf__label">Model confidence</span>}
      <span className="wl-conf__track" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={i < filled ? "wl-conf__seg wl-conf__seg--on" : "wl-conf__seg"} />
        ))}
      </span>
      <span className="wl-conf__value">
        {!large && <span className="sr-only">Confidence </span>}
        {v.toFixed(2)}
      </span>
      {low &&
        (large ? (
          <span className="wl-conf__low wl-conf__low--chip">
            <CircleAlert {...iconProps} />
            Low · check first
          </span>
        ) : (
          <span className="wl-conf__low">
            <CircleAlert {...iconProps} />
            Low
          </span>
        ))}
    </span>
  );
}
