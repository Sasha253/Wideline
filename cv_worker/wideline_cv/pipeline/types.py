"""Shared types of the pipeline (C09): detections, tracks, calibration, events,
and the three pluggable parts (frame source, detector, shirt-number reader).

Coordinates: image pixels are the *video's* pixels (width x height as probed),
whatever size the frames were sampled at; pitch coordinates are metres on the
105 x 68 pitch, camera-fixed (x = 0 at the goal on the camera's left, y = 0 on
the near touchline; Q-043).
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol

import numpy as np
import numpy.typing as npt

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0

DetClass = Literal["person", "ball"]
TeamSide = Literal["home", "away", "unknown"]
EventType = Literal["goal", "shot", "touch"]
CalibrationSource = Literal["stored", "fallback"]

RGB = npt.NDArray[np.uint8]
Matrix = npt.NDArray[np.float64]


@dataclass(frozen=True)
class Frame:
    """One sampled frame: its video time and its pixels (H x W x 3, RGB)."""

    t_ms: int
    rgb: RGB


@dataclass(frozen=True)
class Detection:
    """One box in frame pixels. `truth_id` is set by the synthetic detector only."""

    xyxy: tuple[float, float, float, float]
    score: float
    cls: DetClass
    truth_id: int | None = None


@dataclass
class PersonTrack:
    """A tracked person: per-sample foot points in video pixels, plus what was read."""

    track_id: int
    samples: list[tuple[int, float, float]] = field(default_factory=list)  # (tMs, px, py)
    colours: list[npt.NDArray[np.float64]] = field(default_factory=list)  # Lab per sample
    reads: list[tuple[int, float]] = field(default_factory=list)  # (number, confidence)


@dataclass
class BallTrack:
    """Ball positions per sample in pitch metres; None where it was not seen."""

    t_ms: list[int]
    xy: list[tuple[float, float] | None]
    interpolated: list[bool]
    invisible_ms: int


@dataclass(frozen=True)
class Calibration:
    """Pixel (video px) to pitch metres homography."""

    H: Matrix
    confidence: float
    source: CalibrationSource
    calibration_id: str | None = None


@dataclass(frozen=True)
class PipelineEvent:
    type: EventType
    t_ms: int
    track_index: int | None
    x: float | None
    y: float | None
    confidence: float
    clip_start_ms: int
    clip_end_ms: int
    on_target: bool | None = None


class FrameSource(Protocol):
    def frames(self) -> Iterator[Frame]: ...


class Detector(Protocol):
    """Finds people and the ball. One call per batch of frames."""

    version: str

    def detect(self, frames: Sequence[Frame]) -> list[list[Detection]]: ...


class NumberReader(Protocol):
    """Reads a shirt number from a person's box, or returns None."""

    version: str

    def read(self, frame: Frame, det: Detection) -> tuple[int, float] | None: ...


def batched(items: Iterable[Frame], size: int) -> Iterator[list[Frame]]:
    batch: list[Frame] = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch
