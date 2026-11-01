"use client";

import { Crosshair, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Banner, Field } from "@/components/forms";
import { Button } from "@/components/ui/Button";
import { formatVideoTime } from "@/lib/labels";
import { parseClock, PHASE_LABELS, videoMsToMatchClock, type Markers } from "@/lib/match-clock";
import type { ReviewSide, WorkspaceEntry } from "@/lib/review-workspace";
import type { ReviewRefusal } from "./actions";
import { EventFields, type EventFieldValues } from "./EventFields";

const TIME_FORMAT_ERROR = "Enter a time like 31:24 or 31:24.5.";

/**
 * Add a missed event (REVIEW05; docs/build/design/C11.md, Surface 4). An
 * inline panel under the video, not a modal, so the video stays in view: the
 * time comes from the playhead and the nudge buttons move both. The workspace
 * keys are off inside it (data-review-keys="off"). The server checks again
 * that the raw footage exists (raw_footage_gone).
 */
export function AddMissedEventPanel({
  headingRef,
  player,
  markers,
  halfLengthMinutes,
  durationMs,
  entries,
  teams,
  onAdd,
  onClose,
}: {
  headingRef?: React.Ref<HTMLHeadingElement>;
  player: { currentMs: () => number; seekTo: (ms: number) => void; pause: () => void };
  markers: Partial<Markers>;
  halfLengthMinutes: number;
  durationMs: number | null;
  entries: readonly WorkspaceEntry[];
  teams: Record<ReviewSide, string>;
  onAdd: (timestampMs: number, values: EventFieldValues) => Promise<ReviewRefusal | null>;
  onClose: () => void;
}) {
  const headingId = useId();
  const timeRef = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState(() => formatVideoTime(player.currentMs(), 1));
  const [values, setValues] = useState<EventFieldValues>({
    type: "shot",
    onTarget: false,
    side: "home",
    entryId: null,
  });
  const [timeError, setTimeError] = useState<string | null>(null);
  const [error, setError] = useState<ReviewRefusal | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    player.pause();
    timeRef.current?.focus();
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ms = parseClock(time);
  const clock = ms === null ? null : videoMsToMatchClock(ms, markers, halfLengthMinutes);
  const hint =
    markers.kickoffMs === null || markers.kickoffMs === undefined
      ? "The club has not set kickoff."
      : clock
        ? `Match time ${clock.label || "–"} · ${PHASE_LABELS[clock.phase]}`
        : undefined;
  const rangeError = `Enter a time between 0:00 and ${formatVideoTime(durationMs ?? 0, 0)}.`;

  function check(value: string): number | null {
    const v = parseClock(value);
    if (v === null) {
      setTimeError(TIME_FORMAT_ERROR);
      return null;
    }
    if (v < 0 || (durationMs !== null && v > durationMs)) {
      setTimeError(rangeError);
      return null;
    }
    setTimeError(null);
    return v;
  }

  function move(to: number) {
    const clamped = Math.max(0, durationMs === null ? to : Math.min(durationMs, to));
    setTime(formatVideoTime(clamped, 1));
    setTimeError(null);
    player.seekTo(clamped);
  }

  async function add() {
    if (pending) return;
    const at = check(time);
    if (at === null) {
      timeRef.current?.focus();
      return;
    }
    setPending(true);
    const refusal = await onAdd(at, values);
    setPending(false);
    setError(refusal);
    if (refusal?.field === "time") {
      setTimeError(refusal.message);
      timeRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 border border-dashed border-control bg-panel p-4"
      data-review-keys="off"
      onKeyDown={onKeyDown}
    >
      <h4
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="m-0 font-display text-heading-section uppercase stretch-wide"
      >
        Add missed event
      </h4>
      <form
        noValidate
        className="flex flex-col gap-4"
        aria-busy={pending || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field label="Video time" hint={hint} error={timeError ?? undefined}>
          {(p) => (
            <input
              {...p}
              ref={timeRef}
              className="wl-input font-mono tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onBlur={() => {
                const v = check(time);
                if (v !== null) player.seekTo(v);
              }}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-1.5 tablet:flex tablet:flex-wrap">
          {(
            [
              ["Back 1 s", -1000],
              ["Back 0.1 s", -100],
              ["Forward 0.1 s", 100],
              ["Forward 1 s", 1000],
            ] as const
          ).map(([label, step]) => (
            <Button
              key={label}
              variant="secondary"
              size="s"
              className="font-mono tabular-nums"
              onClick={() => move((parseClock(time) ?? player.currentMs()) + step)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div>
          <Button
            variant="ghost"
            size="s"
            icon={Crosshair}
            onClick={() => move(player.currentMs())}
          >
            Use current video time
          </Button>
        </div>
        <EventFields
          values={values}
          onChange={setValues}
          entries={entries}
          teams={teams}
          playerHint="Optional."
          playerError={error?.field === "player" ? error.message : undefined}
        />
        {error && !error.field && <Banner tone="danger">{error.message}</Banner>}
        <div className="flex flex-col-reverse gap-2 tablet:flex-row">
          <Button variant="ghost" block onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="secondary"
            block
            icon={Plus}
            loading={pending}
            loadingLabel="Adding…"
          >
            Add event
          </Button>
        </div>
      </form>
    </section>
  );
}
