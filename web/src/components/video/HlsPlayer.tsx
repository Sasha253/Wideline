"use client";

import type HlsType from "hls.js";
import type { ErrorData, Level } from "hls.js";
import {
  Captions,
  Check,
  CircleAlert,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { usePopover } from "@/components/shell/usePopover";
import { Skeleton } from "@/components/states/Skeleton";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";
import { formatVideoTime } from "@/lib/labels";

/**
 * The match video player (MATCH06, NFR03, NFR17, NFR25;
 * docs/build/design/C07.md, Surface 1). Plays HLS through hls.js, loaded only
 * when a player mounts, or natively where the browser plays HLS itself
 * (Safari). The marker tool's fallback plays the raw file. Custom controls
 * from tokens: seek slider, play, mute, time in `data`, captions (WebVTT
 * <track>s from the captions prop; HLS subtitle renditions are not served,
 * see rewriteMasterPlaylist), quality and full screen, with keyboard control.
 *
 * Playlists come from session-checked app routes and segments from 60 s
 * presigned URLs (src/server/matches/playback.ts). A 403 on a fragment, or a
 * network error on the file source, reloads the source once at the same
 * position; a second failure in a row shows the error panel.
 *
 * Children's data: never shows or stores names; nothing goes to storage.
 *
 * C11 (REVIEW11): `overlay` renders over the screen area, inside the player
 * root, so it stays on screen in full screen (the review watermark). The
 * video never offers a download, picture-in-picture or its context menu.
 */

export type PlayerSource =
  | { kind: "hls"; url: string }
  | { kind: "file"; url: string; contentType: string; refresh: () => Promise<string | null> };

export type PlayerCaptions = { src: string; label: string; lang: string; default?: boolean }[];

export type PlayerState = "loading" | "ready" | "cannot_play" | "failed";

export type HlsPlayerHandle = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (ms: number) => void;
  seekBy: (ms: number) => void;
  readonly currentMs: number;
};

type Phase = "loading" | "ready" | "cannot_play" | "failed" | "signed_out" | "gone";

type Quality = { index: number; height: number; name: string };

const SEEK_STEP_MS = 5000;
const BUFFERING_DELAY_MS = 500;
/** Playback speeds (Floodlight, Screens B "Workspace · desktop"). */
const RATES = [0.5, 1, 2] as const;

const MESSAGES: Record<"failed" | "cannot_play" | "signed_out" | "gone", string> = {
  failed: "The video stopped loading.",
  cannot_play: "This browser cannot play the video.",
  signed_out: "You have been signed out.",
  gone: "This video is no longer available.",
};

function toState(phase: Phase): PlayerState {
  if (phase === "signed_out" || phase === "gone") return "failed";
  return phase;
}

/** "12:34 of 92:10" for the seek slider. */
export function seekValueText(currentMs: number, durationMs: number): string {
  return `${formatVideoTime(currentMs, 0)} of ${formatVideoTime(durationMs, 0)}`;
}

/**
 * The quality trigger's visible text and accessible name. The name always
 * contains the visible text (WCAG 2.5.3): "Quality: Auto · 720p" while Auto
 * shows the level it picked. The " · 720p" part is hidden below md, which
 * leaves the name still containing the visible "Auto".
 */
export function qualityTrigger(levelName: string, picked: string | null) {
  const detail = picked ? ` · ${picked}` : "";
  return { name: levelName, detail, label: `Quality: ${levelName}${detail}` };
}

/** The quality levels hls.js parsed, highest first, one per height. */
function qualities(levels: Level[]): Quality[] {
  const seen = new Set<number>();
  return levels
    .map((l, index) => ({ index, height: l.height, name: `${l.height}p` }))
    .filter((q) => q.height > 0 && !seen.has(q.height) && seen.add(q.height))
    .sort((a, b) => b.height - a.height);
}

/** Text tracks the captions control can switch: the captions prop's WebVTT tracks. */
function captionTracks(video: HTMLVideoElement | null): TextTrack[] {
  if (!video) return [];
  return Array.from(video.textTracks).filter(
    (t) => t.kind === "captions" || t.kind === "subtitles",
  );
}

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export function HlsPlayer({
  source,
  captions = [],
  title,
  keyboard = "own",
  onTimeUpdate,
  onStateChange,
  onPlayingChange,
  overlay,
  ref,
}: {
  source: PlayerSource;
  captions?: PlayerCaptions;
  /** The group's accessible name: "Match video: {fixture}" or "Match video". */
  title: string;
  /** "own": the player binds its keys. "host": the page drives it through the ref. */
  keyboard?: "own" | "host";
  onTimeUpdate?: (ms: number) => void;
  onStateChange?: (state: PlayerState) => void;
  /** Playing or paused, for a host's own Play button (the marker tool). */
  onPlayingChange?: (playing: boolean) => void;
  /** Drawn over the screen area, never over the controls (C11 watermark). */
  overlay?: ReactNode;
  ref?: Ref<HlsPlayerHandle>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<FullscreenVideo>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const fullscreenRef = useRef<HTMLButtonElement>(null);
  const messageActionRef = useRef<HTMLElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  // One silent reload per failure run; reset by the next good load.
  const reloadedRef = useRef(false);
  const mediaRecoveredRef = useRef(false);
  const resumeRef = useRef<{ at: number; play: boolean } | null>(null);
  const focusPlayOnReadyRef = useRef(false);
  const bufferingTimer = useRef<number | undefined>(undefined);

  const [phase, setPhase] = useState<Phase>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [levels, setLevels] = useState<Quality[]>([]);
  const [level, setLevel] = useState(-1);
  const [autoLevel, setAutoLevel] = useState<string | null>(null);
  const [tracks, setTracks] = useState<{ label: string }[]>([]);
  const [trackOn, setTrackOn] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [rate, setRate] = useState(1);

  const ready = phase === "ready";
  const onStateChangeRef = useRef(onStateChange);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
    onTimeUpdateRef.current = onTimeUpdate;
    onPlayingChangeRef.current = onPlayingChange;
  });

  useEffect(() => {
    onPlayingChangeRef.current?.(playing);
  }, [playing]);

  useEffect(() => {
    onStateChangeRef.current?.(toState(phase));
  }, [phase]);

  // An error panel takes focus when focus was in the player; otherwise its
  // sentence is announced.
  useEffect(() => {
    if (phase === "loading" || phase === "ready") return;
    const inside = rootRef.current?.contains(document.activeElement);
    if (inside && messageActionRef.current) messageActionRef.current.focus();
    else setAnnounce(MESSAGES[phase]);
  }, [phase]);

  const fail = useCallback((next: Exclude<Phase, "loading" | "ready">) => {
    setPhase(next);
    setPlaying(false);
    setBuffering(false);
  }, []);

  /** Reloads the source once, keeping the position and paused state; a second time fails. */
  const reloadOnce = useCallback((): boolean => {
    if (reloadedRef.current) return false;
    reloadedRef.current = true;
    const v = videoRef.current;
    resumeRef.current = { at: v?.currentTime ?? 0, play: !!v && !v.paused };
    setReloadKey((k) => k + 1);
    return true;
  }, []);

  // Attach the source. Runs again for a new URL, a silent reload or Try again.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let live = true;
    const resume = () => {
      const r = resumeRef.current;
      resumeRef.current = null;
      if (!r) return;
      video.currentTime = r.at;
      if (r.play) void video.play().catch(() => {});
    };
    video.addEventListener("loadedmetadata", resume);

    if (source.kind === "file") {
      if (!video.canPlayType(source.contentType)) {
        setPhase("cannot_play");
      } else if (reloadKey > 0) {
        void source.refresh().then((fresh) => {
          if (!live) return;
          if (fresh) video.src = fresh;
          else fail("failed");
        });
      } else {
        video.src = source.url;
      }
      return () => {
        live = false;
        video.removeEventListener("loadedmetadata", resume);
      };
    }

    const url = source.url;
    void (async () => {
      const { default: Hls } = await import("hls.js");
      if (!live) return;
      if (Hls.isSupported()) {
        const hls = new Hls({ capLevelToPlayerSize: true, startLevel: -1 });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(qualities(data.levels));
          setLevel(-1);
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          const h = hls.levels[data.level]?.height;
          setAutoLevel(h ? `${h}p` : null);
        });
        hls.on(Hls.Events.FRAG_LOADED, () => {
          reloadedRef.current = false;
        });
        hls.on(Hls.Events.ERROR, (_e, data: ErrorData) => {
          const code = data.response?.code;
          if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR && code) {
            if (code === 401) return fail("signed_out");
            if (code === 403 || code === 404) return fail("gone");
          }
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveredRef.current) {
            mediaRecoveredRef.current = true;
            hls.recoverMediaError();
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && reloadOnce()) return;
          fail("failed");
        });
        hls.attachMedia(video);
        hls.loadSource(url);
        return;
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS reports no status codes: ask the playlist route first.
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!live) return;
          if (res.status === 401) return fail("signed_out");
          if (res.status === 403 || res.status === 404) return fail("gone");
          if (!res.ok) return fail("failed");
        } catch {
          if (live) fail("failed");
          return;
        }
        video.src = url;
        return;
      }
      setPhase("cannot_play");
    })();

    return () => {
      live = false;
      video.removeEventListener("loadedmetadata", resume);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
    // The source object may be rebuilt on every render; its URL is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, source.url, reloadKey, fail, reloadOnce]);

  // Caption tracks: the captions prop's <track>s, as the browser loads them.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      const list = captionTracks(video);
      setTracks(list.map((t, i) => ({ label: t.label || `Track ${i + 1}` })));
      setTrackOn(list.findIndex((t) => t.mode === "showing"));
    };
    sync();
    video.textTracks.addEventListener("addtrack", sync);
    video.textTracks.addEventListener("removetrack", sync);
    video.textTracks.addEventListener("change", sync);
    return () => {
      video.textTracks.removeEventListener("addtrack", sync);
      video.textTracks.removeEventListener("removetrack", sync);
      video.textTracks.removeEventListener("change", sync);
    };
  }, []);

  // Full screen: the player element where the browser allows it, else the
  // iPhone system player.
  useEffect(() => {
    const root = rootRef.current;
    setCanFullscreen(
      (!!document.fullscreenEnabled && !!root?.requestFullscreen) ||
        !!videoRef.current?.webkitEnterFullscreen,
    );
    const onChange = () => {
      const on = document.fullscreenElement === rootRef.current;
      setFullscreen(on);
      if (!on && !rootRef.current?.contains(document.activeElement)) {
        fullscreenRef.current?.focus();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => () => window.clearTimeout(bufferingTimer.current), []);

  const play = useCallback(() => {
    const v = videoRef.current;
    if (v && phase === "ready") void v.play().catch(() => {});
  }, [phase]);
  const pause = useCallback(() => videoRef.current?.pause(), []);
  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v || phase !== "ready") return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [phase]);
  const seekTo = useCallback(
    (ms: number) => {
      const v = videoRef.current;
      if (!v || phase !== "ready") return;
      const end = Number.isFinite(v.duration) ? v.duration : Infinity;
      v.currentTime = Math.min(end, Math.max(0, ms / 1000));
      setCurrentMs(Math.round(v.currentTime * 1000));
    },
    [phase],
  );
  const seekBy = useCallback(
    (ms: number) => seekTo((videoRef.current?.currentTime ?? 0) * 1000 + ms),
    [seekTo],
  );

  useImperativeHandle(
    ref,
    () => ({
      play,
      pause,
      toggle,
      seekTo,
      seekBy,
      get currentMs() {
        return Math.round((videoRef.current?.currentTime ?? 0) * 1000);
      },
    }),
    [play, pause, toggle, seekTo, seekBy],
  );

  function chooseRate(r: number) {
    const v = videoRef.current;
    if (!v || !ready) return;
    v.playbackRate = r;
    setRate(r);
    setAnnounce(`Speed ${r}×.`);
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v || !ready) return;
    v.muted = !v.muted;
    setAnnounce(v.muted ? "Muted." : "Sound on.");
  }

  function chooseTrack(index: number) {
    const list = captionTracks(videoRef.current);
    list.forEach((t, i) => {
      t.mode = i === index ? "showing" : "disabled";
    });
    setTrackOn(index);
    setAnnounce(index >= 0 ? "Captions on." : "Captions off.");
  }

  function toggleCaptions() {
    if (!tracks.length || !ready) return;
    chooseTrack(trackOn >= 0 ? -1 : 0);
  }

  function chooseLevel(index: number) {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index;
    setLevel(index);
    const name = levels.find((q) => q.index === index)?.name;
    setAnnounce(`Quality set to ${index < 0 || !name ? "Auto" : name}.`);
  }

  function toggleFullscreen() {
    const root = rootRef.current;
    if (!root || !ready) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (document.fullscreenEnabled && root.requestFullscreen) {
      void root.requestFullscreen();
    } else {
      videoRef.current?.webkitEnterFullscreen?.();
    }
  }

  function tryAgain() {
    const v = videoRef.current;
    resumeRef.current = { at: v?.currentTime ?? currentMs / 1000, play: false };
    reloadedRef.current = false;
    mediaRecoveredRef.current = false;
    focusPlayOnReadyRef.current = true;
    setPhase("loading");
    setReloadKey((k) => k + 1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (keyboard !== "own" || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest(".wl-videoplayer__menuwrap")) return;
    if (e.key === " " && target.tagName === "BUTTON") return;
    const actions: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      K: toggle,
      ArrowLeft: () => seekBy(-SEEK_STEP_MS),
      ArrowRight: () => seekBy(SEEK_STEP_MS),
      Home: () => seekTo(0),
      End: () => seekTo(durationMs),
      m: toggleMute,
      M: toggleMute,
      c: toggleCaptions,
      C: toggleCaptions,
      f: toggleFullscreen,
      F: toggleFullscreen,
    };
    const run = actions[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  }

  const onWaiting = () => {
    window.clearTimeout(bufferingTimer.current);
    bufferingTimer.current = window.setTimeout(() => setBuffering(true), BUFFERING_DELAY_MS);
  };
  const clearBuffering = () => {
    window.clearTimeout(bufferingTimer.current);
    setBuffering(false);
  };

  function onVideoError() {
    const v = videoRef.current;
    // hls.js reports its own errors; this is the native and file path.
    if (!v || hlsRef.current) return;
    const code = v.error?.code;
    if (source.kind === "file" && (code === 3 || code === 4)) return fail("cannot_play");
    if (reloadOnce()) return;
    fail("failed");
  }

  const own = keyboard === "own";
  const shortcut = (label: string, key: string) => (own ? `${label} (${key})` : label);
  const seekPct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;
  const message = phase !== "loading" && phase !== "ready" ? phase : null;
  // Levels come from hls.js only: native HLS and the file source have none.
  const showQuality = levels.length > 1;
  const levelName = level < 0 ? "Auto" : (levels.find((q) => q.index === level)?.name ?? "Auto");
  const quality = qualityTrigger(levelName, level < 0 && playing ? autoLevel : null);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={title}
      aria-roledescription="video player"
      aria-busy={phase === "loading" || undefined}
      data-theme={fullscreen ? "dark" : undefined}
      className="wl-videoplayer"
      onKeyDown={onKeyDown}
    >
      <div className="wl-videoplayer__screen">
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          tabIndex={-1}
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          onClick={toggle}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            // A new source resets the speed: keep the one the viewer chose.
            v.playbackRate = rate;
            setDurationMs(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
            setMuted(v.muted);
            setPhase((p) => (p === "loading" || p === "ready" ? "ready" : p));
            if (focusPlayOnReadyRef.current) {
              focusPlayOnReadyRef.current = false;
              window.setTimeout(() => playRef.current?.focus(), 0);
            }
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDurationMs(Math.round(d * 1000));
          }}
          onTimeUpdate={(e) => {
            const ms = Math.round(e.currentTarget.currentTime * 1000);
            setCurrentMs(ms);
            onTimeUpdateRef.current?.(ms);
          }}
          onSeeked={(e) => {
            const ms = Math.round(e.currentTarget.currentTime * 1000);
            setCurrentMs(ms);
            onTimeUpdateRef.current?.(ms);
            clearBuffering();
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onWaiting={onWaiting}
          onPlaying={clearBuffering}
          onCanPlay={clearBuffering}
          onError={onVideoError}
        >
          {captions.map((c) => (
            <track
              key={c.src}
              kind="captions"
              src={c.src}
              label={c.label}
              srcLang={c.lang}
              default={c.default}
            />
          ))}
        </video>
        {overlay}
        {phase === "loading" && (
          <Skeleton shape="video" className="absolute inset-0 h-full w-full" />
        )}
        {ready && buffering && (
          <div className="wl-videoplayer__status text-body-s">
            <LoaderCircle {...iconProps} />
            Loading…
          </div>
        )}
        {message && (
          <div className="wl-videoplayer__message">
            {message === "cannot_play" ? (
              <TriangleAlert {...iconProps} className="text-warning" />
            ) : (
              <CircleAlert {...iconProps} className="text-danger" />
            )}
            <p className="m-0 font-semibold">{MESSAGES[message]}</p>
            {message === "failed" && (
              <>
                <p className="m-0 text-body-s text-ink-muted">
                  Check your connection, then try again.
                </p>
                <Button
                  ref={messageActionRef as Ref<HTMLButtonElement>}
                  variant="secondary"
                  onClick={tryAgain}
                >
                  Try again
                </Button>
              </>
            )}
            {message === "cannot_play" && (
              <p className="m-0 text-body-s text-ink-muted">
                Use a recent version of Chrome, Edge, Firefox or Safari.
              </p>
            )}
            {message === "gone" && (
              <p className="m-0 text-body-s text-ink-muted">
                It may have been deleted, or your access has changed.
              </p>
            )}
            {message === "signed_out" && (
              <ButtonLink
                ref={messageActionRef as Ref<HTMLAnchorElement>}
                variant="secondary"
                href={`/login?next=${encodeURIComponent(window.location.pathname)}`}
              >
                Sign in again
              </ButtonLink>
            )}
          </div>
        )}
      </div>
      <div className="wl-videoplayer__controls">
        <input
          type="range"
          className="wl-videoplayer__seek"
          aria-label="Seek"
          aria-valuetext={seekValueText(currentMs, durationMs)}
          min={0}
          max={Math.max(1, Math.floor(durationMs / 1000))}
          step={1}
          value={Math.floor(currentMs / 1000)}
          disabled={!ready}
          style={{ "--wl-seek": `${seekPct}%` } as CSSProperties}
          onChange={(e) => seekTo(Number(e.target.value) * 1000)}
        />
        <div className="wl-videoplayer__bar">
          <IconButton
            className="wl-videoplayer__btn"
            icon={RotateCcw}
            aria-label="Back 5 seconds"
            title={shortcut("Back 5 seconds", "←")}
            disabled={!ready}
            onClick={() => seekBy(-SEEK_STEP_MS)}
          />
          <IconButton
            ref={playRef}
            className="wl-videoplayer__btn wl-videoplayer__play"
            icon={playing ? Pause : Play}
            aria-label={playing ? "Pause" : "Play"}
            title={shortcut(playing ? "Pause" : "Play", "K")}
            disabled={!ready}
            onClick={toggle}
          />
          <IconButton
            className="wl-videoplayer__btn"
            icon={RotateCw}
            aria-label="Forward 5 seconds"
            title={shortcut("Forward 5 seconds", "→")}
            disabled={!ready}
            onClick={() => seekBy(SEEK_STEP_MS)}
          />
          <IconButton
            className="wl-videoplayer__btn"
            icon={muted ? VolumeX : Volume2}
            aria-label="Mute"
            aria-pressed={muted}
            title={shortcut("Mute", "M")}
            disabled={!ready}
            onClick={toggleMute}
          />
          <span className="wl-videoplayer__time font-mono text-mono-l tabular-nums">
            {formatVideoTime(currentMs, 0)}
            <span className="font-normal text-ink-muted">{` / ${formatVideoTime(durationMs, 0)}`}</span>
          </span>
          <span className="wl-videoplayer__spacer" />
          <span
            role="group"
            aria-label="Playback speed"
            data-review-keys="off"
            className="hidden gap-0.5 rounded-control border border-line p-0.5 tablet:flex"
          >
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rate === r}
                disabled={!ready}
                className={cx(
                  "min-h-8 rounded-control px-2 font-mono text-mono-m tabular-nums",
                  rate === r
                    ? "bg-selected text-ink"
                    : "bg-transparent text-ink-muted hover:text-ink",
                )}
                onClick={() => chooseRate(r)}
              >
                {r}×
              </button>
            ))}
          </span>
          {(tracks.length > 0 || captions.length > 0) &&
            (tracks.length > 1 ? (
              <PlayerMenu
                heading="Captions"
                label="Captions"
                title={shortcut("Captions", "C")}
                text={null}
                icon={Captions}
                disabled={!ready}
                items={[
                  { value: -1, label: "Off" },
                  ...tracks.map((t, i) => ({ value: i, label: t.label })),
                ]}
                current={trackOn}
                pressed={trackOn >= 0}
                onChoose={chooseTrack}
              />
            ) : (
              <IconButton
                className="wl-videoplayer__btn"
                icon={Captions}
                aria-label="Captions"
                aria-pressed={trackOn >= 0}
                title={shortcut("Captions", "C")}
                disabled={!ready}
                onClick={toggleCaptions}
              />
            ))}
          {showQuality && (
            <PlayerMenu
              heading="Quality"
              label={quality.label}
              text={
                <>
                  {quality.name}
                  {quality.detail && <span className="hidden tablet:inline">{quality.detail}</span>}
                </>
              }
              icon={Settings2}
              disabled={!ready}
              items={[
                { value: -1, label: "Auto" },
                ...levels.map((q) => ({ value: q.index, label: q.name })),
              ]}
              current={level}
              note="Picks the best quality for your connection."
              onChoose={chooseLevel}
            />
          )}
          {canFullscreen && (
            <IconButton
              ref={fullscreenRef}
              className="wl-videoplayer__btn"
              icon={fullscreen ? Minimize : Maximize}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={shortcut(fullscreen ? "Exit full screen" : "Full screen", "F")}
              disabled={!ready}
              onClick={toggleFullscreen}
            />
          )}
        </div>
      </div>
      {phase === "loading" && <span className="sr-only">Loading video…</span>}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/**
 * The quality (or captions) menu: a disclosure popover above the bar
 * (docs/build/design/D02.md popovers). Opening moves focus to the current
 * item; ↑ and ↓ move between items; choosing closes and returns focus.
 */
export function PlayerMenu({
  heading,
  label,
  title,
  text,
  icon: Icon,
  disabled,
  items,
  current,
  pressed,
  note,
  onChoose,
}: {
  heading: string;
  label: string;
  /** The icon trigger's tooltip, e.g. "Captions (C)"; defaults to the label. */
  title?: string;
  text: React.ReactNode;
  icon: typeof Settings2;
  disabled: boolean;
  items: { value: number; label: string }[];
  current: number;
  pressed?: boolean;
  note?: string;
  onChoose: (value: number) => void;
}) {
  const { open, close, panelId, wrapperProps, triggerProps, panelProps } = usePopover();

  useEffect(() => {
    if (!open) return;
    panelProps.ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    // panelProps.ref is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(
      panelProps.ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return (
    <div className="wl-videoplayer__menuwrap" data-review-keys="off" {...wrapperProps}>
      {text === null ? (
        <button
          type="button"
          className="wl-iconbtn wl-videoplayer__btn"
          aria-label={label}
          aria-pressed={pressed}
          title={title ?? label}
          disabled={disabled}
          {...triggerProps}
        >
          <Icon {...iconProps} />
        </button>
      ) : (
        <button
          type="button"
          className="wl-btn wl-btn--ghost wl-btn--s wl-videoplayer__quality"
          aria-label={label}
          disabled={disabled}
          {...triggerProps}
        >
          <Icon {...iconProps} />
          <span className="wl-videoplayer__qualitytext text-label">{text}</span>
        </button>
      )}
      {open && (
        <div
          {...panelProps}
          id={panelId}
          className="wl-popover wl-videoplayer__menu"
          onKeyDown={onPanelKeyDown}
        >
          <p className="wl-popover__heading text-label">{heading}</p>
          {items.map((item, i) => (
            <Fragment key={item.value}>
              <button
                type="button"
                className="wl-popover__item"
                aria-pressed={item.value === current}
                onClick={() => {
                  onChoose(item.value);
                  close(true);
                }}
              >
                {item.value === current ? (
                  <Check {...iconProps} />
                ) : (
                  <span className="wl-videoplayer__menuslot" aria-hidden="true" />
                )}
                {item.label}
              </button>
              {note && i === 0 && (
                <p className="m-0 px-3 pb-2 text-body-s text-ink-muted">{note}</p>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
