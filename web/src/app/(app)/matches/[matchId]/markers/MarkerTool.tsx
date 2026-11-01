"use client";

import { Check, Clock, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Banner,
  Field,
  fieldError,
  FormBusy,
  FormErrorBanner,
  SubmitButton,
  SuccessBanner,
  useFocusFirstInvalid,
  useFormAction,
} from "@/components/forms";
import { Workspace } from "@/components/templates/Workspace";
import { Button, Kbd } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import {
  HlsPlayer,
  type HlsPlayerHandle,
  type PlayerSource,
  type PlayerState,
} from "@/components/video/HlsPlayer";
import type { ActionResult } from "@/lib/action-result";
import { formatVideoTime } from "@/lib/labels";
import {
  halfDuration,
  MARKER_KEYS,
  MARKER_LABELS,
  parseClock,
  PHASE_LABELS,
  validateMarkers,
  videoMsToMatchClock,
  type MarkerKey,
  type Markers,
} from "@/lib/match-clock";
import { saveMarkersAction } from "./actions";

const HINTS: Record<MarkerKey, string> = {
  kickoffMs: "The first whistle.",
  halfTimeMs: "The whistle that ends the first half.",
  secondHalfKickoffMs: "The whistle that starts the second half.",
  fullTimeMs: "The final whistle.",
};

const SET_LABELS: Record<MarkerKey, string> = {
  kickoffMs: "Set kickoff here",
  halfTimeMs: "Set half-time here",
  secondHalfKickoffMs: "Set second-half kickoff here",
  fullTimeMs: "Set full time here",
};

const toText = (m: Markers): Record<MarkerKey, string> =>
  Object.fromEntries(
    MARKER_KEYS.map((k) => [k, m[k] === null ? "" : formatVideoTime(m[k]!)]),
  ) as Record<MarkerKey, string>;

function parsed(values: Record<MarkerKey, string>): Partial<Markers> {
  return Object.fromEntries(
    MARKER_KEYS.map((k) => [k, values[k].trim() ? parseClock(values[k]) : null]),
  ) as Partial<Markers>;
}

/** Inputs whose keys the marker shortcuts leave alone. The seek slider is not one. */
function isTextInput(target: HTMLElement): boolean {
  if (target.tagName === "INPUT") return (target as HTMLInputElement).type !== "range";
  return target.tagName === "SELECT" || target.tagName === "TEXTAREA";
}

/**
 * The kickoff and half-time marker tool (MATCH05; docs/build/design/C06.md,
 * Surface 5): the match player, four markers set from the current time or
 * typed, and keyboard shortcuts with visible buttons. Typed entry is the
 * fallback when the browser cannot play the file. C07
 * (docs/build/design/C07.md, Surface 4): HlsPlayer in host mode, driven
 * through its handle; HLS once the transcode is ready, the raw file on a
 * 15-minute signed URL until then.
 */
export function MarkerTool({
  matchId,
  hlsUrl,
  fileUrl,
  contentType,
  halfLengthMinutes,
  initial,
  locked,
  durationMs = 0,
}: {
  /** The footage length from the probe, for the scrubber. 0 hides it. */
  durationMs?: number;
  matchId: string;
  /** The master playlist route once HLS is ready, else null. */
  hlsUrl: string | null;
  /** The raw file's signed URL, used until HLS is ready. */
  fileUrl: string | null;
  contentType: string;
  halfLengthMinutes: number;
  initial: Markers;
  locked: boolean;
}) {
  const playerRef = useRef<HlsPlayerHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [playback, setPlayback] = useState<PlayerState>("loading");
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [values, setValues] = useState(() => toText(initial));
  const [announce, setAnnounce] = useState("");
  const { state, formProps } = useFormAction(saveMarkersAction, null as ActionResult);
  useFocusFirstInvalid(formRef, state);
  // Compared as times, not text ("0:05" is "0:05.0"). The server re-renders the
  // page with the saved times after a save, so `initial` is always the saved state.
  const dirty = MARKER_KEYS.some((k) => {
    const typed = values[k].trim();
    return (typed ? parseClock(typed) : null) !== initial[k];
  });

  // Signs the raw file again: the player's refresh when the URL expires.
  const fetchUrl = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/matches/${matchId}/video-url`, { cache: "no-store" });
      if (!res.ok) return null;
      return ((await res.json()) as { url: string }).url;
    } catch {
      return null;
    }
  }, [matchId]);

  // Stable across renders, so the player never reloads on a re-render.
  const source = useMemo<PlayerSource | null>(() => {
    if (hlsUrl) return { kind: "hls", url: hlsUrl };
    if (fileUrl) return { kind: "file", url: fileUrl, contentType, refresh: fetchUrl };
    return null;
  }, [hlsUrl, fileUrl, contentType, fetchUrl]);

  const okKey = state?.ok ? state.key : undefined;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const usable = playback === "ready";

  function seekBy(deltaMs: number) {
    const player = playerRef.current;
    if (!player || !usable) return;
    player.seekBy(deltaMs);
    // The readout follows at once, not after the seek lands (C06).
    setCurrentMs(player.currentMs);
  }

  function togglePlay() {
    if (usable) playerRef.current?.toggle();
  }

  function setMarker(key: MarkerKey) {
    const text = formatVideoTime(currentMs);
    setValues((s) => ({ ...s, [key]: text }));
    setAnnounce(`${MARKER_LABELS[key]} set to ${text}.`);
  }

  function goTo(key: MarkerKey) {
    const ms = parseClock(values[key]);
    if (ms === null || !usable) return;
    playerRef.current?.seekTo(ms);
    setCurrentMs(ms);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (isTextInput(target)) return;
    if (!usable || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? 10_000 : 1000;
    const actions: Record<string, () => void> = {
      k: togglePlay,
      K: togglePlay,
      ArrowLeft: () => seekBy(-step),
      ArrowRight: () => seekBy(step),
      ",": () => seekBy(-100),
      ".": () => seekBy(100),
    };
    // Space plays and pauses (A11Y.md), except on a button or link, where it keeps its
    // native activation.
    if (e.key === " " && !target.closest("button, a, [role='button']")) {
      actions[" "] = togglePlay;
    }
    // M sets the next marker that is still empty, from the current frame.
    if ((e.key === "m" || e.key === "M") && !locked && nextKey) {
      actions[e.key] = () => setMarker(nextKey);
    }
    const run = actions[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  }

  const markers = parsed(values);
  const nextKey = MARKER_KEYS.find((k) => markers[k] == null) ?? null;
  const clockFor = (k: MarkerKey): string | null => {
    const ms = markers[k];
    if (ms == null) return null;
    return videoMsToMatchClock(ms, markers, halfLengthMinutes)?.label ?? null;
  };
  const setCount = MARKER_KEYS.length - MARKER_KEYS.filter((k) => markers[k] == null).length;
  const clock = videoMsToMatchClock(currentMs, markers, halfLengthMinutes);
  const order = validateMarkers(markers);

  const derived = (key: MarkerKey): string | null => {
    const m = markers;
    if (key === "halfTimeMs" && m.kickoffMs != null && m.halfTimeMs != null && !order.halfTimeMs) {
      const d = halfDuration(m.kickoffMs, m.halfTimeMs, halfLengthMinutes, 0);
      return `First half: ${d.minutes} min (${d.clock}).`;
    }
    if (
      key === "fullTimeMs" &&
      m.secondHalfKickoffMs != null &&
      m.fullTimeMs != null &&
      !order.fullTimeMs
    ) {
      const d = halfDuration(
        m.secondHalfKickoffMs,
        m.fullTimeMs,
        halfLengthMinutes,
        halfLengthMinutes,
      );
      return `Second half: ${d.minutes} min (${d.clock}).`;
    }
    return null;
  };

  const broken = playback === "cannot_play" || playback === "failed" || !source;
  const videoPane = (
    <>
      {source?.kind === "file" && !broken && (
        <p className="mb-2 text-body-s text-ink-muted">
          Playing the original file while we prepare smoother playback.
        </p>
      )}
      {source && (
        <div hidden={broken}>
          <HlsPlayer
            ref={playerRef}
            source={source}
            title="Match video"
            keyboard="host"
            onTimeUpdate={setCurrentMs}
            onStateChange={setPlayback}
            onPlayingChange={setPlaying}
          />
        </div>
      )}
      {playback === "cannot_play" ? (
        <Banner tone="warn">
          This browser cannot play your video file. Type the times instead: play the file on your
          computer or camera, and note the time at each whistle.
        </Banner>
      ) : (
        broken && (
          <Banner tone="danger">
            The video stopped loading. Reload the page to carry on. Unsaved times are kept until you
            leave.
          </Banner>
        )
      )}
      {usable && (
        <>
          <dl className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono tabular-nums">
            <dt className="sr-only">Video time</dt>
            <dd className="m-0 text-mono-l">
              video {formatVideoTime(currentMs)}
              {durationMs > 0 && (
                <span className="font-normal text-ink-muted">
                  {" "}
                  / {formatVideoTime(durationMs, 0)}
                </span>
              )}
            </dd>
            {clock && (
              <>
                <dt className="sr-only">Match clock</dt>
                <dd className="m-0 text-body-s text-ink-muted">
                  match{" "}
                  {clock.label
                    ? `${clock.label} · ${PHASE_LABELS[clock.phase]}`
                    : PHASE_LABELS[clock.phase]}
                </dd>
              </>
            )}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="s"
              icon={playing ? Pause : Play}
              kbd="K"
              onClick={togglePlay}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <Button variant="secondary" size="s" kbd="⇧←" onClick={() => seekBy(-10_000)}>
              Back 10 s
            </Button>
            <Button variant="secondary" size="s" kbd="←" onClick={() => seekBy(-1000)}>
              Back 1 s
            </Button>
            <Button variant="secondary" size="s" kbd="," onClick={() => seekBy(-100)}>
              Back 0.1 s
            </Button>
            <Button variant="secondary" size="s" kbd="." onClick={() => seekBy(100)}>
              Forward 0.1 s
            </Button>
            <Button variant="secondary" size="s" kbd="→" onClick={() => seekBy(1000)}>
              Forward 1 s
            </Button>
            <Button variant="secondary" size="s" kbd="⇧→" onClick={() => seekBy(10_000)}>
              Forward 10 s
            </Button>
          </div>
          {durationMs > 0 && (
            <Scrubber
              durationMs={durationMs}
              currentMs={currentMs}
              markers={markers}
              halfLengthMinutes={halfLengthMinutes}
            />
          )}
          <div className="mt-3 flex flex-col gap-2 border border-line px-3.5 py-3 text-body-s text-ink-muted">
            <span className="font-semibold text-ink">Keyboard</span>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
              <dt>
                <Kbd>Space</Kbd> <Kbd>K</Kbd>
              </dt>
              <dd className="m-0">Play or pause</dd>
              <dt>
                <Kbd>←</Kbd> <Kbd>→</Kbd>
              </dt>
              <dd className="m-0">Move 1 s, with Shift 10 s</dd>
              <dt>
                <Kbd>,</Kbd> <Kbd>.</Kbd>
              </dt>
              <dd className="m-0">Move 0.1 s</dd>
              {!locked && (
                <>
                  <dt>
                    <Kbd>M</Kbd>
                  </dt>
                  <dd className="m-0">Set the next marker to the current frame</dd>
                </>
              )}
            </dl>
          </div>
        </>
      )}
    </>
  );

  const markerPane = locked ? (
    <dl className="m-0 border border-line bg-panel">
      {MARKER_KEYS.map((k) => (
        <div
          key={k}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line px-4 py-3 last:border-b-0"
        >
          <dt className="font-semibold">{MARKER_LABELS[k]}</dt>
          <dd className="m-0 font-mono tabular-nums">
            {values[k] || <span className="font-ui text-ink-muted">Not set</span>}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <form ref={formRef} {...formProps} noValidate>
      <FormBusy formRef={formRef} />
      <input type="hidden" name="matchId" value={matchId} />
      <div className="flex items-baseline justify-between gap-3 border border-line bg-panel px-4 py-3 shadow-[inset_0_-1px_0_var(--wl-color-ink)]">
        <span className="font-mono text-body-s text-ink-muted tabular-nums">
          {setCount} of {MARKER_KEYS.length} set
        </span>
      </div>
      <ul role="list" className="border-x border-b border-line bg-panel">
        {MARKER_KEYS.map((k) => {
          const note = derived(k);
          const isSet = markers[k] != null;
          const isNext = k === nextKey;
          return (
            <li
              key={k}
              data-next={isNext || undefined}
              className={cx(
                "flex flex-col gap-2.5 border-b border-line px-4 py-3 last:border-b-0",
                isNext && "bg-raised shadow-[inset_2px_0_0_var(--wl-color-ink)]",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cx(
                    "box-border grid size-5 place-items-center rounded-full",
                    isSet
                      ? "border-2 border-confirmed bg-confirmed text-on-status"
                      : "border-pending text-pending",
                  )}
                >
                  {isSet ? <Check {...iconProps} size={12} /> : <Clock {...iconProps} size={12} />}
                </span>
                <span className="text-body-s text-ink-muted">
                  {isSet ? "Set" : "Not set"}
                  {isSet && clockFor(k) && ` · match ${clockFor(k)}`}
                </span>
              </span>
              <Field
                label={MARKER_LABELS[k]}
                hint={`${HINTS[k]} For example 2:31.`}
                error={fieldError(state, k)}
              >
                {(p) => (
                  <input
                    {...p}
                    name={k}
                    className="wl-input"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[k]}
                    onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
                  />
                )}
              </Field>
              {usable && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="s" onClick={() => setMarker(k)}>
                    {SET_LABELS[k]}
                  </Button>
                  <Button
                    variant="ghost"
                    size="s"
                    aria-label={`Go to ${MARKER_LABELS[k].toLowerCase()} in the video`}
                    disabled={parseClock(values[k]) === null}
                    onClick={() => goTo(k)}
                  >
                    Go to
                  </Button>
                </div>
              )}
              {usable && isNext && (
                <Button variant="secondary" size="m" block kbd="M" onClick={() => setMarker(k)}>
                  Set {MARKER_LABELS[k].toLowerCase()} to {formatVideoTime(currentMs, 0)}
                </Button>
              )}
              {note && <p className="text-body-s text-ink-muted">{note}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-col gap-3">
        <FormErrorBanner result={state} />
        {dirty && <p className="text-body-s text-ink-muted">Unsaved changes</p>}
        <div>
          <SubmitButton block pendingLabel="Saving" className="justify-center">
            Save markers
          </SubmitButton>
        </div>
      </div>
    </form>
  );

  return (
    <div onKeyDown={onKeyDown}>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        <SuccessBanner key={okKey} result={state} />
      </div>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <div className="mt-6">
        <Workspace
          primary={{ title: "Video", content: videoPane }}
          side={{ title: "Markers", content: markerPane }}
        />
      </div>
    </div>
  );
}

const SCRUB_CODES: Record<MarkerKey, string> = {
  kickoffMs: "KO",
  halfTimeMs: "HT",
  secondHalfKickoffMs: "2H",
  fullTimeMs: "FT",
};

/**
 * The marker scrubber (Screens A, "Upload · markers"): the whole recording with the halves
 * it maps to, the set markers as ink diamonds (KO, HT, 2H, FT) and the lime playhead. A
 * picture of the times in the fields beside it, so it is hidden from screen readers; the
 * player's own seek slider and the fields carry the same information.
 */
function Scrubber({
  durationMs,
  currentMs,
  markers,
  halfLengthMinutes,
}: {
  durationMs: number;
  currentMs: number;
  markers: Partial<Markers>;
  halfLengthMinutes: number;
}) {
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  const ko = markers.kickoffMs;
  const ht = markers.halfTimeMs;
  const sh = markers.secondHalfKickoffMs;
  const ft = markers.fullTimeMs;
  const ticks: number[] = [];
  for (let m = 0; m * 60_000 <= durationMs; m += 15) ticks.push(m);
  const first =
    ko != null && ht != null && ht > ko ? halfDuration(ko, ht, halfLengthMinutes, 0) : null;
  return (
    <div aria-hidden="true" className="relative mt-4 h-24 border-t border-line font-mono">
      <div className="absolute inset-x-0 top-10 h-3 bg-selected" />
      {ko != null && ht != null && ht > ko && (
        <>
          <span
            className="absolute top-10 h-3 bg-line-strong"
            style={{ left: pct(ko), width: `calc(${pct(ht)} - ${pct(ko)})` }}
          />
          <span
            className="absolute top-14.5 ml-1 text-overline tracking-normal text-ink-muted"
            style={{ left: pct(ko) }}
          >
            1st half{first ? ` · ${first.clock}` : ""}
          </span>
        </>
      )}
      {sh != null && (
        <>
          <span
            className="absolute top-10 h-3 bg-line-strong"
            style={{ left: pct(sh), width: `calc(${pct(ft ?? durationMs)} - ${pct(sh)})` }}
          />
          <span
            className="absolute top-14.5 ml-1 text-overline tracking-normal text-ink-muted"
            style={{ left: pct(sh) }}
          >
            2nd half
          </span>
        </>
      )}
      {MARKER_KEYS.map((k) => {
        const ms = markers[k];
        if (ms == null) return null;
        return (
          <span key={k}>
            <span
              className="absolute top-3 flex -translate-x-1/2 flex-col items-center gap-1"
              style={{ left: pct(ms) }}
            >
              <span className="text-overline leading-none font-bold tracking-normal">
                {SCRUB_CODES[k]}
              </span>
              <span className="size-2.5 rotate-45 bg-ink" />
            </span>
            <span className="absolute top-9 h-5 w-px bg-ink" style={{ left: pct(ms) }} />
          </span>
        );
      })}
      <span
        className="absolute top-1 -ml-px h-14 w-0.5 bg-brand"
        style={{ left: pct(currentMs) }}
      />
      <span
        className="absolute top-1 -translate-x-[calc(100%+6px)] bg-brand px-1.5 py-0.5 text-overline leading-none font-bold tracking-normal text-on-brand"
        style={{ left: pct(currentMs) }}
      >
        {formatVideoTime(currentMs, 0)}
      </span>
      <div className="absolute inset-x-0 top-20 text-overline tracking-normal text-ink-muted">
        {ticks.map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: pct(m * 60_000) }}>
            {String(m).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}
