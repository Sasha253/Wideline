"use client";

import { Pause, Play } from "lucide-react";
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

const KEYS: Record<string, MarkerKey> = {
  "1": "kickoffMs",
  "2": "halfTimeMs",
  "3": "secondHalfKickoffMs",
  "4": "fullTimeMs",
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
}: {
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
    const actions: Record<string, () => void> = {
      k: togglePlay,
      K: togglePlay,
      ArrowLeft: () => seekBy(-1000),
      ArrowRight: () => seekBy(1000),
      ",": () => seekBy(-100),
      ".": () => seekBy(100),
    };
    const marker = KEYS[e.key];
    const run = actions[e.key] ?? (marker && !locked ? () => setMarker(marker) : undefined);
    if (!run) return;
    e.preventDefault();
    run();
  }

  const markers = parsed(values);
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
        <p className="caption mb-2 text-ink-muted">
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
          <dl className="wl-row mt-3">
            <dt className="label">Video time</dt>
            <dd className="data">{formatVideoTime(currentMs)}</dd>
            {clock && (
              <>
                <dt className="label ml-4">Match clock</dt>
                <dd className="data">
                  {clock.label
                    ? `${clock.label} · ${PHASE_LABELS[clock.phase]}`
                    : PHASE_LABELS[clock.phase]}
                </dd>
              </>
            )}
          </dl>
          <div className="wl-row mt-3">
            <Button
              variant="secondary"
              size="sm"
              icon={playing ? Pause : Play}
              kbd="K"
              onClick={togglePlay}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <Button variant="secondary" size="sm" kbd="←" onClick={() => seekBy(-1000)}>
              Back 1 s
            </Button>
            <Button variant="secondary" size="sm" kbd="," onClick={() => seekBy(-100)}>
              Back 0.1 s
            </Button>
            <Button variant="secondary" size="sm" kbd="." onClick={() => seekBy(100)}>
              Forward 0.1 s
            </Button>
            <Button variant="secondary" size="sm" kbd="→" onClick={() => seekBy(1000)}>
              Forward 1 s
            </Button>
          </div>
          <details className="mt-3">
            <summary className="label">Keyboard shortcuts</summary>
            <dl className="wl-facts mt-2">
              <dt>
                <Kbd>K</Kbd>
              </dt>
              <dd className="body">Play or pause</dd>
              <dt>
                <Kbd>←</Kbd> <Kbd>→</Kbd>
              </dt>
              <dd className="body">Move 1 s</dd>
              <dt>
                <Kbd>,</Kbd> <Kbd>.</Kbd>
              </dt>
              <dd className="body">Move 0.1 s</dd>
              {!locked && (
                <>
                  <dt>
                    <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> <Kbd>4</Kbd>
                  </dt>
                  <dd className="body">
                    Set kickoff, half-time, second-half kickoff and full time to the current time
                  </dd>
                </>
              )}
            </dl>
          </details>
        </>
      )}
    </>
  );

  const markerPane = locked ? (
    <dl className="wl-facts">
      {MARKER_KEYS.map((k) => (
        <div key={k} className="contents">
          <dt className="label">{MARKER_LABELS[k]}</dt>
          <dd className="data">
            {values[k] || <span className="body text-ink-muted">Not set</span>}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <form ref={formRef} {...formProps} noValidate>
      <FormBusy formRef={formRef} />
      <input type="hidden" name="matchId" value={matchId} />
      <ul role="list">
        {MARKER_KEYS.map((k, i) => {
          const note = derived(k);
          return (
            <li key={k} className="wl-marker">
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
                <div className="wl-marker__actions wl-row">
                  <Button
                    variant="secondary"
                    size="sm"
                    kbd={String(i + 1)}
                    onClick={() => setMarker(k)}
                  >
                    {SET_LABELS[k]}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Go to ${MARKER_LABELS[k].toLowerCase()} in the video`}
                    disabled={parseClock(values[k]) === null}
                    onClick={() => goTo(k)}
                  >
                    Go to
                  </Button>
                </div>
              )}
              {note && <p className="caption text-ink-muted">{note}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-col gap-3">
        <FormErrorBanner result={state} />
        {dirty && <p className="caption text-ink-muted">Unsaved changes</p>}
        <div>
          <SubmitButton block pendingLabel="Saving…" className="justify-center">
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
