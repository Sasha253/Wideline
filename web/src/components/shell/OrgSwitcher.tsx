"use client";

import { Check, ChevronDown, ChevronsUpDown, CircleAlert } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { switchOrganisation } from "@/app/(app)/organisations/actions";
import { cx } from "@/components/ui/cx";
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
 * Initials for the organisation tile: the first letter of the first two words, or the
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

const icon16 = { size: 16, strokeWidth: 1.8, "aria-hidden": true } as const;

/** The square initials tile (ink on the current organisation). Never a logo or photo. */
function OrgTile({
  name,
  size,
  current = true,
}: {
  name: string;
  size: "m" | "s";
  current?: boolean;
}) {
  return (
    <span
      className={cx(
        "wl-org-tile",
        size === "s" && "wl-org-tile--s",
        !current && "wl-org-tile--other",
      )}
      aria-hidden="true"
    >
      {orgInitials(name)}
    </span>
  );
}

/** "Owner · 3 organisations": the roles here, and how many organisations there are. */
function triggerMeta(org: SwitcherOrganisation, count: number): string {
  return count > 1 ? `${org.rolesLabel} · ${count} organisations` : org.rolesLabel;
}

/**
 * The organisation switcher (AUTH05; Floodlight app shell). The organisation's name is always
 * on screen. With one organisation it is static. With more, a popover lists them: the current
 * one is marked (selected fill and a check), and every other one is a form that posts to
 * switchOrganisation, which redirects to the root and so to the role home.
 *
 * - `sidebar`: tile, name, roles and count, chevrons. 992px and up.
 * - `rail`: a 40px tile button, named "Organisation: …. Switch organisation". 768 to 991px.
 * - `topbar`: tile, name and a chevron, filling the phone top bar.
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
      <div className="wl-org-rail wl-org-rail--static" title={org.name}>
        <OrgTile name={org.name} size="s" />
        <span className="sr-only">Organisation: {org.name}</span>
      </div>
    );
  }
  if (variant === "topbar") {
    return (
      <div className="wl-org-top wl-org-top--static">
        <OrgTile name={org.name} size="m" />
        <p className="wl-org-top__name" title={org.name}>
          {org.name}
        </p>
      </div>
    );
  }
  return (
    <div className="wl-org-side wl-org-side--static">
      <OrgTile name={org.name} size="m" />
      <span className="wl-org-side__text">
        <span className="sr-only">Organisation: </span>
        <span className="wl-org-side__name" title={org.name} data-testid="active-organisation">
          {org.name}
        </span>
        <span className="wl-org-side__meta">{triggerMeta(org, 1)}</span>
      </span>
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

  // A refused switch keeps the popover open and moves focus to the message, so it is read.
  useEffect(() => {
    if (refused) errorRef.current?.focus();
  }, [state, refused]);

  return (
    <div
      {...wrapperProps}
      className={cx(
        "wl-switcher",
        variant === "topbar" ? "wl-switcher--topbar" : "relative",
        variant === "rail" && "flex justify-center",
      )}
    >
      {variant === "rail" ? (
        // Named by its content, not aria-label: the initials would not be part of the label.
        <button type="button" {...triggerProps} title={current.name} className="wl-org-rail">
          <OrgTile name={current.name} size="s" />
          <span className="sr-only">{label}</span>
        </button>
      ) : variant === "topbar" ? (
        <button type="button" {...triggerProps} aria-label={label} className="wl-org-top">
          <OrgTile name={current.name} size="m" />
          <span className="wl-org-top__name" title={current.name}>
            {current.name}
          </span>
          <ChevronDown {...icon16} className="wl-org-chevron" />
        </button>
      ) : (
        <button type="button" {...triggerProps} aria-label={label} className="wl-org-side">
          <OrgTile name={current.name} size="m" />
          <span className="wl-org-side__text">
            <span
              className="wl-org-side__name"
              title={current.name}
              data-testid="active-organisation"
            >
              {current.name}
            </span>
            {/* Keeps the visible words apart. */}{" "}
            <span className="wl-org-side__meta">{triggerMeta(current, organisations.length)}</span>
          </span>
          <ChevronsUpDown {...icon16} className="wl-org-chevron" />
        </button>
      )}
      {open && (
        <div
          {...panelProps}
          role="region"
          aria-label="Your organisations"
          className={cx("wl-popover wl-popover--menu", PLACEMENT[variant])}
        >
          <p className="wl-popover__heading">Switch organisation</p>
          {refused && (
            <div ref={errorRef} tabIndex={-1} className="wl-popover__alert-wrap">
              <div className="wl-shell-alert" role="alert">
                <CircleAlert {...icon16} />
                <p>{state.formError}</p>
              </div>
            </div>
          )}
          <ul role="list" aria-busy={pending || undefined}>
            {organisations.map((o) => {
              const meta = `${o.typeLabel} · ${o.rolesLabel}`;
              if (o.id === current.id) {
                return (
                  <li key={o.id} aria-current="true">
                    <div className="wl-org-option wl-org-option--current">
                      <OrgTile name={o.name} size="m" />
                      <span className="wl-org-option__text">
                        <span className="wl-org-option__name">{o.name}</span>
                        <span className="wl-org-option__meta">{meta}</span>
                      </span>
                      <span className="wl-org-option__check">
                        <Check {...icon16} />
                        <span className="sr-only">Current</span>
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
                      className="wl-org-option"
                      disabled={pending}
                      onClick={() => setClicked(o.id)}
                    >
                      <OrgTile name={o.name} size="m" current={false} />
                      <span className="wl-org-option__text">
                        <span className="sr-only">Switch to </span>
                        <span className="wl-org-option__name">{o.name}</span>
                        <span className="wl-org-option__meta">
                          {pending && clicked === o.id ? "Switching…" : meta}
                        </span>
                      </span>
                      <span className="wl-org-option__check" />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          <p className="wl-popover__note">You join organisations by invitation from their admin.</p>
        </div>
      )}
    </div>
  );
}
