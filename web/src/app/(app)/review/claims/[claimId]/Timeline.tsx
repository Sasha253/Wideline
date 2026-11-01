"use client";

import { useImperativeHandle, useState, type Ref } from "react";
import { cx } from "@/components/ui/cx";
import { eventDisc } from "@/components/ui/ReviewEventRow";
import { TeamMarker } from "@/components/ui/TeamMarker";
import type { Markers } from "@/lib/match-clock";
import type { WorkspaceEvent } from "@/lib/review-workspace";

export type TimelineHandle = { setMs: (ms: number) => void };

const MINUTE = 60 * 1000;

/** Tick height by type: goal > shot > touch (Floodlight, Screens B "Review workspace"). */
const TICK_HEIGHT: Record<WorkspaceEvent["type"], string> = {
  goal: "h-8",
  shot: "h-5",
  touch: "h-3",
};

/**
 * Where a match minute falls in the video: first half from kickoff, second half from the
 * second-half kickoff. Null without a match clock.
 */
function minuteMs(minute: number, markers: Partial<Markers>, half: number): number | null {
  const kickoff = markers.kickoffMs;
  if (kickoff == null) return null;
  if (minute <= half) return kickoff + minute * MINUTE;
  const second = markers.secondHalfKickoffMs;
  if (second == null) return null;
  return second + (minute - half) * MINUTE;
}

/**
 * The match timeline under the video: home ticks above the axis, away below, tick height
 * by event type, a muted half-time line and the lime playhead (the only lime: the current
 * minute). Rejected events are faded. Visual only: the event list is the accessible
 * version, so the whole strip is one image with a summary.
 */
export function Timeline({
  events,
  selectedId,
  markers,
  halfLengthMinutes,
  durationMs,
  clockOk,
  timeLabel,
  compact = false,
  ref,
}: {
  /** The playhead's label: match time ("31:24"), or video time without a clock. */
  timeLabel: (ms: number) => string;
  events: readonly WorkspaceEvent[];
  selectedId: string | null;
  markers: Partial<Markers>;
  halfLengthMinutes: number;
  durationMs: number;
  clockOk: boolean;
  /** The phone strip: no side markers and no minute labels. */
  compact?: boolean;
  ref?: Ref<TimelineHandle>;
}) {
  const [ms, setMs] = useState(0);
  useImperativeHandle(ref, () => ({ setMs }), []);
  const span = Math.max(1, durationMs);
  const at = (v: number) => `${Math.min(100, Math.max(0, (v / span) * 100))}%`;

  // Minute labels every 15 minutes: match minutes with a clock, else video minutes.
  const labels: { key: string; left: string; text: string }[] = [];
  const lastMinute = clockOk ? 2 * halfLengthMinutes : Math.floor(span / MINUTE);
  for (let m = 0; m <= lastMinute; m += 15) {
    const v = clockOk ? minuteMs(m, markers, halfLengthMinutes) : m * MINUTE;
    if (v === null || v > span) continue;
    labels.push({ key: String(m), left: at(v), text: String(m).padStart(2, "0") });
  }
  const halfTime = markers.halfTimeMs ?? null;
  const home = events.filter((e) => e.side === "home").length;
  const away = events.filter((e) => e.side === "away").length;

  return (
    <div
      role="img"
      aria-label={`Match timeline: ${home} home ${home === 1 ? "event" : "events"} above the line, ${away} away below.`}
      className={cx("relative select-none", compact ? "h-11" : "h-36")}
    >
      {!compact && (
        <div className="absolute top-5 left-3 flex flex-col gap-5" aria-hidden="true">
          <TeamMarker side="home" size={20} />
          <TeamMarker side="away" size={20} />
        </div>
      )}
      <div
        className={cx("absolute inset-y-0", compact ? "right-0 left-0" : "right-5 left-12")}
        aria-hidden="true"
      >
        {/* The axis. */}
        <div
          className={cx("absolute inset-x-0 h-px bg-control", compact ? "top-[50%]" : "top-14")}
        />
        {events.map((e) => {
          if (!e.side) return null;
          const disc = eventDisc(e.status);
          const up = e.side === "home";
          return (
            <span
              key={e.id}
              className={cx(
                "absolute w-0.75 -ml-px",
                compact ? (e.type === "goal" ? "h-4" : "h-2.5") : TICK_HEIGHT[e.type],
                up ? "bg-home" : "bg-away",
                disc === "rejected" && "opacity-35",
                e.id === selectedId && "outline-2 outline-offset-1 outline-ink",
                compact
                  ? up
                    ? "bottom-[50%]"
                    : "top-[50%]"
                  : up
                    ? "bottom-[calc(100%-3.5rem)]"
                    : "top-[3.5625rem]",
              )}
              style={{ left: at(e.timestampMs) }}
            />
          );
        })}
        {halfTime !== null && halfTime <= span && (
          <>
            <span
              className={cx("absolute w-px bg-ink-muted", compact ? "inset-y-1" : "top-5 h-17")}
              style={{ left: at(halfTime) }}
            />
            {!compact && (
              <span
                className="absolute top-2 -translate-x-1/2 font-mono text-overline text-ink-muted"
                style={{ left: at(halfTime) }}
              >
                HT
              </span>
            )}
          </>
        )}
        {/* The playhead: lime, the current minute only. */}
        <span
          className={cx("absolute w-0.5 -ml-px bg-brand", compact ? "inset-y-1" : "top-0 h-23")}
          style={{ left: at(ms) }}
        />
        {!compact && (
          <span
            className="absolute top-1.5 ml-1.5 border border-brand-edge bg-brand px-1.5 py-0.5 font-mono text-mono-m font-bold text-on-brand tabular-nums"
            style={{ left: at(ms) }}
          >
            {timeLabel(ms)}
          </span>
        )}
        {!compact && (
          <div className="absolute inset-x-0 top-25 font-mono text-overline text-ink-muted tabular-nums">
            {labels.map((l, i) => (
              <span
                key={l.key}
                className={cx("absolute", i > 0 && "-translate-x-1/2")}
                style={{ left: l.left }}
              >
                {l.text}
              </span>
            ))}
          </div>
        )}
        {!compact && (
          <div className="absolute right-0 top-30 text-body-s text-ink-muted">
            Tick height: goal &gt; shot &gt; touch
          </div>
        )}
      </div>
    </div>
  );
}
