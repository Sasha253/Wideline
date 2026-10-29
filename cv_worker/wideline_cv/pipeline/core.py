"""The pipeline itself; see wideline_cv/pipeline/__init__.py."""

from __future__ import annotations

import os
import struct
import time
import urllib.error
import urllib.request
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import numpy as np
import structlog

from .. import events as ev
from .. import teams
from ..calibration import FALLBACK_WARNING, fallback, from_spec, on_pitch, project
from ..contract import SCHEMA_VERSION
from ..numbers import NullReader, vote
from ..redact import clean
from ..track.ball import BallTracker, invisible_warning
from ..track.people import PeopleTracker
from .types import RGB, Calibration, Detection, Detector, Frame, NumberReader, PersonTrack, batched

TRACKER_VERSION = "bytetrack-wl-1"
DEFAULT_SYNTHETIC_MAX_SEC = 600
DEFAULT_SYNTHETIC_SEED = 7
STILL_AT_MS = 10_000
COLOUR_EVERY = 3  # torso colour from every third sample of a track
MAX_WARNINGS = 100

log = structlog.get_logger()


def mode() -> str:
    """synthetic or model, from WIDELINE_CV_MODE; synthetic when the extra is absent."""
    wanted = os.environ.get("WIDELINE_CV_MODE", "").strip().lower()
    if wanted in ("synthetic", "model"):
        return wanted
    from ..detect.rfdetr_detector import model_available

    return "model" if model_available() else "synthetic"


def still_ms(duration_ms: int) -> int:
    """When the calibration still is taken: 10 s in, or halfway through a shorter
    video, on the 5 fps grid. web/src/server/cv/calibration.ts has the same rule."""
    return (min(STILL_AT_MS, duration_ms // 2) // 200) * 200


def encode_png(rgb: RGB) -> bytes:
    """A plain RGB PNG (no external library)."""
    h, w = rgb.shape[:2]
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )


def put_still(url: str, rgb: RGB) -> None:
    req = urllib.request.Request(
        url, data=encode_png(rgb), method="PUT", headers={"Content-Type": "image/png"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60):
            pass
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"still upload answered {err.code}") from None


@dataclass
class Parts:
    """Everything the pipeline needs for one run."""

    frames: Iterator[Frame]
    detector: Detector
    reader: NumberReader
    frame_scale: tuple[float, float]  # frame px to video px
    duration_ms: int  # what the pipeline covers (synthetic: the capped scenario)


def _synthetic_parts(spec: dict[str, Any], video_size: tuple[int, int]) -> Parts:
    from ..synthetic.detector import SyntheticDetector
    from ..synthetic.reader import SyntheticReader
    from ..synthetic.render import SyntheticFrames
    from ..synthetic.scene import FRAME_H, FRAME_W, Scene

    cap = float(os.environ.get("WIDELINE_CV_SYNTHETIC_MAX_SEC") or DEFAULT_SYNTHETIC_MAX_SEC)
    seed = int(
        spec.get("syntheticSeed")
        or os.environ.get("WIDELINE_CV_SYNTHETIC_SEED")
        or DEFAULT_SYNTHETIC_SEED
    )
    scene = Scene(seed, min(float(spec.get("durationSec") or 60.0), cap))
    return Parts(
        frames=SyntheticFrames(scene).frames(),
        detector=SyntheticDetector(scene),
        reader=SyntheticReader(scene),
        frame_scale=(video_size[0] / FRAME_W, video_size[1] / FRAME_H),
        duration_ms=scene.duration_ms,
    )


def _model_parts(
    spec: dict[str, Any], video_size: tuple[int, int], should_stop: Callable[[], bool]
) -> Parts:
    from ..detect.rfdetr_detector import RFDetrDetector
    from .frames import sample_frames

    detector = RFDetrDetector()
    fps = float(spec.get("sampledFps") or 5)
    return Parts(
        frames=sample_frames(spec["videoUrl"], fps=fps, should_stop=should_stop, size=video_size),
        detector=detector,
        reader=NullReader(),
        frame_scale=(1.0, 1.0),
        duration_ms=round(float(spec.get("durationSec") or 0) * 1000),
    )


StillSink = Callable[[RGB], None]


def run(
    spec: dict[str, Any], should_stop: Callable[[], bool], on_still: StillSink | None = None
) -> dict[str, Any]:
    chosen = spec.get("mode") or mode()
    video_size = (int(spec.get("width") or 1920), int(spec.get("height") or 1080))
    log.info("pipeline_mode", mode=chosen, jobId=spec.get("jobId"))
    if chosen == "model":
        parts = _model_parts(spec, video_size, should_stop)
    else:
        parts = _synthetic_parts(spec, video_size)
    return process(spec, parts, video_size, should_stop, on_still)


def _stage(name: str, started: float, **counts: int) -> float:
    now = time.monotonic()
    log.info("pipeline_stage", stage=name, ms=int((now - started) * 1000), **counts)
    return now


def process(
    spec: dict[str, Any],
    parts: Parts,
    video_size: tuple[int, int],
    should_stop: Callable[[], bool],
    on_still: StillSink | None = None,
) -> dict[str, Any]:
    t0 = time.monotonic()
    duration_ms = max(parts.duration_ms, 1)
    sx, sy = parts.frame_scale
    people = PeopleTracker(scale=(sx, sy))
    ball_px: list[tuple[int, list[tuple[float, float, float]]]] = []
    first: RGB | None = None
    still: tuple[int, RGB] | None = None
    target_still = still_ms(duration_ms)
    frames = 0
    batch = max(1, int(os.environ.get("WIDELINE_CV_BATCH", "8")))

    def per_person(frame: Frame, det: Detection, track: PersonTrack) -> None:
        if len(track.samples) % COLOUR_EVERY == 1:
            colour = teams.torso_colour(frame.rgb, det)
            if colour is not None:
                track.colours.append(colour)
        read = parts.reader.read(frame, det)
        if read is not None:
            track.reads.append(read)

    for chunk in batched(parts.frames, batch):
        if should_stop():
            raise RuntimeError("stopped")
        for frame, dets in zip(chunk, parts.detector.detect(chunk), strict=True):
            frames += 1
            if first is None:
                first = frame.rgb
            if still is None and frame.t_ms >= target_still:
                still = (frame.t_ms, frame.rgb.copy())
            people.update(frame, dets, per_person)
            balls = [
                ((d.xyxy[0] + d.xyxy[2]) / 2 * sx, (d.xyxy[1] + d.xyxy[3]) / 2 * sy, d.score)
                for d in dets
                if d.cls == "ball"
            ]
            ball_px.append((frame.t_ms, balls))
    if first is None:
        raise RuntimeError("no frames could be read from the video")
    t1 = _stage("detect_and_track", t0, frames=frames, tracks=len(people.tracks))

    still_frame = still[1] if still else first
    warnings: list[str] = []
    calibration: Calibration | None = from_spec(spec)
    if calibration is None:
        calibration = fallback(still_frame, video_size)
        warnings.append(FALLBACK_WARNING)
    h = calibration.H

    # People: foot points to metres. Raw positions drive events; output is
    # clamped to the pitch, or dropped more than 2 m off it.
    finished = people.finished()
    raw: list[list[tuple[int, float, float]]] = []
    for track in finished:
        pts = project(h, [(px, py) for _, px, py in track.samples])
        raw.append(
            [(t, float(x), float(y)) for (t, _, _), (x, y) in zip(track.samples, pts, strict=True)]
        )

    tracker = BallTracker()
    for t_ms, cands in ball_px:
        if cands:
            pts = project(h, [(c[0], c[1]) for c in cands])
            tracker.update(
                t_ms, [(float(p[0]), float(p[1]), c[2]) for p, c in zip(pts, cands, strict=True)]
            )
        else:
            tracker.update(t_ms, [])
    ball = tracker.finish()
    if (w := invisible_warning(ball)) is not None:
        warnings.append(w)
    t2 = _stage("calibrate_and_project", t1, points=sum(len(r) for r in raw))

    colours = [np.median(np.array(t.colours), axis=0) if t.colours else None for t in finished]
    mean_x = [float(np.mean([p[1] for p in r])) if r else None for r in raw]
    zones = [teams.goal_zone_shares([p[1] for p in r]) for r in raw]
    team = teams.assign_teams(colours, mean_x, zones)
    warnings.extend(team.warnings)

    out_tracks: list[dict[str, Any]] = []
    index_of: dict[int, int] = {}
    for i, track in enumerate(finished):
        points: dict[int, tuple[float, float]] = {}
        for t, x, y in raw[i]:
            spot = on_pitch(x, y)
            if spot is not None:
                points[t] = spot
        if not points:
            continue
        number, conf = vote(track.reads) if team.roles[i] != "official" else (None, None)
        index_of[i] = len(out_tracks)
        out_tracks.append(
            {
                "trackIndex": len(out_tracks),
                "teamSide": team.sides[i],
                "shirtNumber": number,
                "shirtConfidence": conf,
                "points": [
                    {"tMs": t, "x": round(x, 2), "y": round(y, 2)}
                    for t, (x, y) in sorted(points.items())
                ],
            }
        )
    t3 = _stage("teams_and_numbers", t2, tracks=len(out_tracks))

    found = ev.detect_events(ball, [(index_of[i], raw[i]) for i in index_of], duration_ms)
    out_events = []
    for e in found:
        item: dict[str, Any] = {
            "type": e.type,
            "trackIndex": e.track_index,
            "tMs": e.t_ms,
            "x": e.x,
            "y": e.y,
            "confidence": e.confidence,
            "clipStartMs": e.clip_start_ms,
            "clipEndMs": e.clip_end_ms,
        }
        if e.type == "shot":
            item["onTarget"] = bool(e.on_target)
        out_events.append(item)
    _stage("events", t3, events=len(out_events))

    still_url = spec.get("stillUrl")
    if on_still is not None:
        on_still(still_frame)
    elif still_url:
        try:
            put_still(still_url, still_frame)
        except Exception as err:  # best effort: the run still counts
            log.warning("still_upload_failed", error=clean(str(err)))
            warnings.append("calibration still not saved")

    result: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "jobId": spec["jobId"],
        "matchId": spec["matchId"],
        "modelVersions": {
            "detector": parts.detector.version,
            "tracker": TRACKER_VERSION,
            "events": ev.VERSION,
            "teams": teams.VERSION,
            "numbers": parts.reader.version,
        },
        "video": {
            "durationSec": float(spec.get("durationSec") or duration_ms / 1000),
            "fps": float(spec.get("fps") or 25.0),
            "sampledFps": float(spec.get("sampledFps") or 5),
        },
        "calibration": {
            "confidence": round(calibration.confidence, 4),
            "homography": [[float(f"{v:.10g}") for v in row] for row in h.tolist()],
        },
        "tracks": out_tracks,
        "events": out_events,
        "warnings": [w[:200] for w in warnings[:MAX_WARNINGS]],
    }
    _stage("total", t0, tracks=len(out_tracks), events=len(out_events))
    return result
