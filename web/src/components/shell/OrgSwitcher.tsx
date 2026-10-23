"use client";

import { Check, ChevronsUpDown, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { switchOrganisation } from "@/app/(app)/organisations/actions";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { usePopover } from "./usePopover";

/** One organisation as the switcher shows it. Labels come from src/lib/labels.ts. */
export type SwitcherOrganisation = {
  id: string;
  name: string;
  /** "Club", "Academy", "Wideline platform". */
  typeLabel: string;
  /** "Owner, Coach". */
  rolesLabel: string;
};

export type SwitcherVariant = "sidebar" | "rail" | "topbar";

/**
 * Initials for the rail avatar: the first letter of the first two words, or the
 * first two letters of a one-word name ("Wideline Demo FC" is "WD", "Hellenic" is "HE").
 */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase();
}

const PLACEMENT: Record<SwitcherVariant, string> = {
  sidebar: "wl-popover--below",
  rail: "wl-popover--beside",
  topbar: "wl-popover--sheet",
};

/**
 * The organisation switcher (AUTH05; docs/build/design/D02.md, Surface 3). With one
 * organisation it is static text. With more, a disclosure popover lists them: the current
 * one is marked, and every other one is a form that posts to switchOrganisation, which
 * redirects to the root and so to the role home.
 */
export function OrgSwitcher({
  organisations,
  currentId,
  variant,
}: {
  organisations: SwitcherOrganisation[];
  currentId: string;
  variant: SwitcherVariant;
}) {
  const current = organisations.find((o) => o.id === currentId);
  if (!current) return null;
  if (organisations.length < 2) return <StaticTrigger org={current} variant={variant} />;
  return <SwitcherPopover organisations={organisations} current={current} variant={variant} />;
}

function StaticTrigger({ org, variant }: { org: SwitcherOrganisation; variant: SwitcherVariant }) {
  if (variant === "rail") {
    return (
      <div className="flex justify-center">
        <span className="wl-avatar" aria-hidden="true">
          {orgInitials(org.name)}
        </span>
        <span className="sr-only">Organisation: {org.name}</span>
      </div>
    );
  }
  if (variant === "topbar") {
    return (
      <p className="body-strong min-w-0 flex-1 truncate" title={org.name}>
        {org.name}
      </p>
    );
  }
  return (
    <div className="wl-switcher wl-switcher--static">
      <div className="min-w-0">
        <p className="eyebrow text-ink-muted">Organisation</p>
        <p className="body-strong truncate" title={org.name} data-testid="active-organisation">
          {org.name}
        </p>
        <p className="caption text-ink-muted">{org.typeLabel}</p>
      </div>
    </div>
  );
}

function SwitcherPopover({
  organisations,
  current,
  variant,
}: {
  organisations: SwitcherOrganisation[];
  current: SwitcherOrganisation;
  variant: SwitcherVariant;
}) {
  const { open, wrapperProps, triggerProps, panelProps } = usePopover();
  const [state, action, pending] = useActionState(switchOrganisation, null);
  const [clicked, setClicked] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const refused = state && !state.ok;
  const label = `Organisation: ${current.name}. Switch organisation`;

  // A refused switch keeps the popover open and moves focus to the banner, so it is read.
  useEffect(() => {
    if (refused) errorRef.current?.focus();
  }, [state, refused]);

  return (
    <div
      {...wrapperProps}
      className={cx(
        variant === "topbar" ? "flex min-w-0 flex-1" : "relative",
        variant === "rail" && "flex justify-center",
      )}
    >
      {variant === "rail" ? (
        // Named by its content, not aria-label: the initials would not be part of the label.
        <button
          type="button"
          {...triggerProps}
          title={current.name}
          className="wl-switcher__avatar"
        >
          <span className="wl-avatar" aria-hidden="true">
            {orgInitials(current.name)}
          </span>
          <span className="sr-only">{label}</span>
        </button>
      ) : (
        <button
          type="button"
          {...triggerProps}
          aria-label={label}
          className={cx("wl-switcher", variant === "topbar" && "wl-switcher--compact")}
        >
          <span className="min-w-0">
            {variant === "sidebar" && (
              <span className="eyebrow block text-ink-muted">Organisation</span>
            )}
            {/* Keeps the visible words apart, so they read as the start of the aria-label. */}
            {variant === "sidebar" && " "}
            <span
              className="body-strong block truncate"
              title={current.name}
              data-testid={variant === "sidebar" ? "active-organisation" : undefined}
            >
              {current.name}
            </span>
          </span>
          <ChevronsUpDown {...iconProps} />
        </button>
      )}
      {open && (
        <div
          {...panelProps}
          role="region"
          aria-label="Your organisations"
          className={cx("wl-popover", PLACEMENT[variant])}
        >
          <p className="wl-popover__heading label">Switch organisation</p>
          {refused && (
            <div ref={errorRef} tabIndex={-1} className="mx-1 mb-1 outline-none">
              <div className="wl-banner wl-banner--danger" role="alert">
                <CircleAlert {...iconProps} />
                <p className="body">{state.formError}</p>
              </div>
            </div>
          )}
          <ul role="list" aria-busy={pending || undefined}>
            {organisations.map((o) => {
              const meta = `${o.typeLabel} · ${o.rolesLabel}`;
              if (o.id === current.id) {
                return (
                  <li key={o.id} aria-current="true">
                    <div className="wl-popover__item wl-popover__item--static">
                      <span className="min-w-0 flex-1">
                        <span className="body-strong block break-words">{o.name}</span>
                        <span className="caption block text-ink-muted">{meta}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-pitch">
                        <Check {...iconProps} />
                        <span className="label">Current</span>
                      </span>
                    </div>
                  </li>
                );
              }
              return (
                <li key={o.id}>
                  <form action={action}>
                    <input type="hidden" name="organisationId" value={o.id} />
                    <button
                      type="submit"
                      className="wl-popover__item"
                      disabled={pending}
                      onClick={() => setClicked(o.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="sr-only">Switch to </span>
                        <span className="body-strong block break-words">{o.name}</span>
                        <span className="caption block text-ink-muted">
                          {pending && clicked === o.id ? "Switching…" : meta}
                        </span>
                      </span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          <div className="wl-popover__footer">
            <Link href="/organisations" className="wl-popover__item body">
              Your organisations
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
