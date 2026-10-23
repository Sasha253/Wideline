import type { ConsentState, PreferredFoot } from "@/generated/prisma/enums";
import Link from "next/link";
import { ConsentBadge } from "./ConsentBadge";
import { PlayerCardMenu } from "./PlayerCardMenu";

const FOOT: Record<PreferredFoot, string> = {
  left: "Left foot",
  right: "Right foot",
  both: "Both feet",
};

/** First letter of the first and last words, uppercase: "Thabo Nkosi" is "TN". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export type PlayerStat = { label: string; value: string };

/**
 * Summarises one player in search results, shortlists and squad lists. The
 * whole card links to the profile: the name is a stretched link, so the menu
 * button is never nested inside a link. Avatars are initials, never photos.
 *
 * Pass `consent` in club views only. Scouts never see the consent badge.
 */
export function PlayerCard({
  name,
  position,
  ageGroup,
  foot,
  currentClub,
  formerClub,
  consent,
  stats,
  href,
  onAddToShortlist,
  shortlistHref,
}: {
  name: string;
  position: string;
  ageGroup: string;
  foot: PreferredFoot;
  currentClub?: string;
  /** Shown as "Former club: …" when there is no current club. */
  formerClub?: string;
  consent?: ConsentState;
  /** Up to 4 key stats for the position; any more are left out. */
  stats: PlayerStat[];
  href: string;
  onAddToShortlist?: () => void;
  shortlistHref?: string;
}) {
  const club = currentClub ?? (formerClub ? `Former club: ${formerClub}` : "No current club");
  const shown = stats.slice(0, 4);

  return (
    <article className="wl-card wl-player relative transition-colors duration-150 ease-out hover:border-line-strong">
      <span className="wl-avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <div className="min-w-0">
        <div className="wl-player__name line-clamp-2">
          <Link
            href={href}
            className="wl-player__link text-ink no-underline after:absolute after:inset-0"
          >
            {name}
          </Link>
        </div>
        <div className="wl-player__meta">
          {position} · {ageGroup} · {FOOT[foot]} · {club}
        </div>
        {consent && (
          <div className="mt-2">
            <ConsentBadge state={consent} />
          </div>
        )}
      </div>
      <div className="relative z-10 self-start">
        <PlayerCardMenu
          name={name}
          profileHref={href}
          onAddToShortlist={onAddToShortlist}
          shortlistHref={shortlistHref}
        />
      </div>
      {shown.length > 0 && (
        <div className="wl-player__stats">
          {shown.map((s) => (
            <div key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
