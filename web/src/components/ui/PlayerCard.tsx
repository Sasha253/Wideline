"use client";

import type { ConsentState, PreferredFoot } from "@/generated/prisma/enums";
import { Bookmark, CircleAlert, LogOut } from "lucide-react";
import Link from "next/link";
import { ConsentBadge } from "./ConsentBadge";
import { cx } from "./cx";
import { iconProps } from "./icons";

/** First letter of the first and last words, uppercase: "Thabo Nkosi" is "TN". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** @deprecated Use PlayerFigure. */
export type PlayerStat = { label: string; value: string };

/** One of the card's three figures: a per-90 rate, linked to its clips when it can be. */
export type PlayerFigure = { label: string; value: string; unit?: string; href?: string };

/**
 * A player in search results, shortlists and the squad (Floodlight, "Player card").
 * The avatar is always initials, never a photo. The name is a stretched link, so the whole
 * card opens the profile; the figures and the shortlist toggle sit above it.
 *
 * - `viewer="scout"`: the shortlist toggle (`aria-pressed`). Never the consent badge:
 *   scouts only ever see players whose guardians said yes.
 * - `viewer="club"`: the consent badge instead of the toggle.
 * - `departed`: club view only. No figures, just the departure line.
 * - `loading`: static blocks in the same footprint as a loaded card.
 * - Use the same three figures for every card in a grid, so they line up.
 */
export function PlayerCard({
  name,
  position,
  ageGroup,
  number,
  currentClub,
  formerClub,
  consent,
  viewer,
  figures,
  stats,
  sample,
  matches,
  href,
  shortlisted = false,
  shortlistName,
  onToggleShortlist,
  onAddToShortlist,
  shortlistHref,
  departed,
  loading = false,
  className,
}: {
  name: string;
  /** "CM", or the full name of the position. */
  position: string;
  ageGroup: string;
  /** @deprecated Not shown in Floodlight. */
  foot?: PreferredFoot;
  /** Shirt number: "No. 8" in the meta line. */
  number?: number | null;
  currentClub?: string;
  /** Shown as "Former club: …" when there is no current club. */
  formerClub?: string;
  /** Club views only. Implies `viewer="club"` when `viewer` is left out. */
  consent?: ConsentState;
  viewer?: "scout" | "club";
  /** Three figures; any more are left out. */
  figures?: PlayerFigure[];
  /** @deprecated Use `figures`. Mapped onto figures, three at most. */
  stats?: PlayerStat[];
  /** The footer: "8 matches · 2026 season". */
  sample?: string;
  /** Under 3 adds the "Small sample" flag in the footer. */
  matches?: number;
  href: string;
  /** Scout view: is the player on one of the scout's shortlists? */
  shortlisted?: boolean;
  /** The shortlist's name, for the toggle's label when shortlisted ("On Midfield U17"). */
  shortlistName?: string;
  /** Scout view: called with the new value when the toggle is pressed. */
  onToggleShortlist?: (next: boolean) => void;
  /** @deprecated Use `onToggleShortlist`. Still works: pressing the toggle calls it. */
  onAddToShortlist?: () => void;
  /** A link to add the player to a shortlist, for views without JavaScript actions. */
  shortlistHref?: string;
  /** The player left the club (club views): no figures. `on` is the date, "14 Aug 2026". */
  departed?: { on: string };
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div
        className={cx("wl-pcard", className)}
        role="status"
        aria-busy="true"
        aria-label="Loading player"
      >
        <div className="wl-pcard__skel" aria-hidden="true">
          <span className="wl-block size-11" />
          <span className="flex flex-col gap-2">
            <span className="wl-block h-3.25 w-[70%]" />
            <span className="wl-block h-2.5 w-[45%]" />
            <span className="wl-block h-2.5 w-[60%]" />
          </span>
        </div>
        <div className="h-14.5 border-t border-line" aria-hidden="true" />
        <div className="h-9 border-t border-line" aria-hidden="true" />
      </div>
    );
  }

  const isClub = viewer ? viewer === "club" : consent !== undefined;
  const club = currentClub ?? (formerClub ? `Former club: ${formerClub}` : "No current club");
  const meta = [position, ageGroup, number != null ? `No. ${number}` : null]
    .filter(Boolean)
    .join(" · ");
  const shown: PlayerFigure[] = (figures ?? stats ?? []).slice(0, 3);
  const toggle = !isClub && (onToggleShortlist || onAddToShortlist || shortlistHref);
  const toggleLabel = shortlisted
    ? shortlistName
      ? `On ${shortlistName}`
      : "On a shortlist"
    : "Add to shortlist";

  return (
    <article
      className={cx("wl-pcard", departed && "wl-pcard--departed", className)}
      aria-label={name}
    >
      <div className={cx("wl-pcard__head", toggle && "wl-pcard__head--toggle")}>
        <span className={cx("wl-avatar", departed && "wl-avatar--muted")} aria-hidden="true">
          {initials(name)}
        </span>
        <span className="wl-pcard__who">
          <span className="wl-pcard__name">
            <Link href={href} className="wl-pcard__link">
              {name}
            </Link>
          </span>
          {meta && <span className="wl-pcard__meta">{meta}</span>}
          <span className="wl-pcard__club">{departed ? "Former player" : club}</span>
        </span>
        {toggle &&
          (shortlistHref && !onToggleShortlist && !onAddToShortlist ? (
            <Link href={shortlistHref} className="wl-pcard__toggle" aria-label={toggleLabel}>
              <Bookmark {...iconProps} fill={shortlisted ? "currentColor" : "none"} />
            </Link>
          ) : (
            <button
              type="button"
              className="wl-pcard__toggle"
              aria-label={toggleLabel}
              aria-pressed={shortlisted}
              onClick={() => {
                if (onToggleShortlist) onToggleShortlist(!shortlisted);
                else onAddToShortlist?.();
              }}
            >
              <Bookmark {...iconProps} fill={shortlisted ? "currentColor" : "none"} />
            </button>
          ))}
      </div>
      {isClub && consent && (
        <div className="wl-pcard__badge">
          <ConsentBadge state={consent} />
        </div>
      )}
      {departed ? (
        <div className="wl-pcard__departed">
          <LogOut {...iconProps} />
          <span>
            Left the club on {departed.on}. Stats stay with the club, and scouts can no longer see
            them.
          </span>
        </div>
      ) : (
        shown.length > 0 && (
          <>
            <div className="wl-pcard__figs">
              {shown.map((f) => {
                const inner = (
                  <>
                    <span className="wl-pcard__fig-label">{f.label}</span>
                    <span className="wl-pcard__fig-value">
                      <b>{f.value}</b>
                      {f.unit && <span>{f.unit}</span>}
                    </span>
                  </>
                );
                return f.href ? (
                  <Link key={f.label} href={f.href} className="wl-pcard__fig">
                    {inner}
                  </Link>
                ) : (
                  <div key={f.label} className="wl-pcard__fig">
                    {inner}
                  </div>
                );
              })}
            </div>
            {(sample || matches !== undefined) && (
              <div className="wl-pcard__foot">
                <span>{sample ?? (matches === 1 ? "1 match" : `${matches} matches`)}</span>
                {matches !== undefined && matches < 3 && (
                  <span className="wl-flag">
                    <CircleAlert {...iconProps} />
                    Small sample
                  </span>
                )}
              </div>
            )}
          </>
        )
      )}
    </article>
  );
}
