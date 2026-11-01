"use client";

import { useId } from "react";
import { Field } from "@/components/forms";
import { cx } from "@/components/ui/cx";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { ReviewEventType, ReviewSide, WorkspaceEntry } from "@/lib/review-workspace";

/** What an event is: shared by the edit sheet and the add panel (C11, Surface 2). */
export type EventFieldValues = {
  type: ReviewEventType;
  onTarget: boolean;
  side: ReviewSide;
  entryId: string | null;
};

const TYPES: { value: ReviewEventType; label: string }[] = [
  { value: "goal", label: "Goal" },
  { value: "shot", label: "Shot" },
  { value: "touch", label: "Touch" },
];

/**
 * One segment of a radio group (Floodlight, Screens B "Workspace · phone edit"): a native
 * radio, visually hidden, in a 44px label. Selected is ink (bg-selected and a 1px ink
 * inset), never lime; focus moves the ring onto the label.
 */
function Segment({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cx(
        "relative flex h-control-l min-w-0 cursor-pointer items-center justify-center gap-2 rounded-control px-3 text-center",
        "has-[:focus-visible]:ring-focus",
        checked
          ? "bg-selected font-semibold text-ink shadow-[inset_0_0_0_1px_var(--wl-color-ink)]"
          : "text-ink-muted hover:bg-raised",
      )}
    >
      <input
        type="radio"
        name={name}
        // Covers the segment, invisible: clicks land on the radio itself.
        className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0"
        checked={checked}
        onChange={onChange}
      />
      {children}
    </label>
  );
}

export function EventFields({
  values,
  onChange,
  entries,
  teams,
  playerError,
  playerHint,
  playerRef,
}: {
  values: EventFieldValues;
  onChange: (next: EventFieldValues) => void;
  entries: readonly WorkspaceEntry[];
  teams: Record<ReviewSide, string>;
  playerError?: string;
  playerHint?: string;
  playerRef?: React.Ref<HTMLSelectElement>;
}) {
  const name = useId();
  const options = entries
    .filter((e) => e.side === values.side)
    .sort((a, b) => a.shirtNumber - b.shirtNumber);
  return (
    <>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-label">Event</legend>
        <div className="grid grid-cols-3 gap-0.5 rounded-control border border-line p-0.5">
          {TYPES.map((t) => (
            <Segment
              key={t.value}
              name={`${name}-type`}
              checked={values.type === t.value}
              onChange={() => onChange({ ...values, type: t.value })}
            >
              {t.label}
            </Segment>
          ))}
        </div>
      </fieldset>
      {values.type === "shot" && (
        <label className="flex min-h-control-l items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={values.onTarget}
            onChange={(e) => onChange({ ...values, onTarget: e.target.checked })}
          />
          On target
        </label>
      )}
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-label">Side</legend>
        <div className="grid grid-cols-1 gap-0.5 rounded-control border border-line p-0.5 tablet:grid-cols-2">
          {(["home", "away"] as const).map((s) => (
            <Segment
              key={s}
              name={`${name}-side`}
              checked={values.side === s}
              // A side change reloads the players and resets the pick.
              onChange={() => onChange({ ...values, side: s, entryId: null })}
            >
              <TeamMarker
                side={s}
                name={`${s === "home" ? "Home" : "Away"} · ${teams[s]}`}
                truncate
              />
            </Segment>
          ))}
        </div>
      </fieldset>
      {options.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-label">Player</p>
          <p className="m-0 text-ink-muted">The club has not entered a lineup for this side.</p>
        </div>
      ) : (
        <Field label="Player" hint={playerHint} error={playerError}>
          {(p) => (
            <select
              {...p}
              ref={playerRef}
              className="wl-input"
              value={values.entryId ?? ""}
              onChange={(e) => onChange({ ...values, entryId: e.target.value || null })}
            >
              <option value="">No player (team only)</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </>
  );
}
