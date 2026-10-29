"""The synthetic shirt-number reader (C09): reads a person's scene shirt
number now and then, with a confidence, and misreads one time in twenty.
Deterministic for the scene's seed, the sample and the person."""

from __future__ import annotations

from ..pipeline.types import Detection, Frame
from .scene import SAMPLE_MS, Scene, unit

VERSION = "synthetic-1"
READ_PROBABILITY = 0.2
MISREAD = 0.05


class SyntheticReader:
    version = VERSION

    def __init__(self, scene: Scene) -> None:
        self.scene = scene

    def read(self, frame: Frame, det: Detection) -> tuple[int, float] | None:
        if det.truth_id is None or det.truth_id < 0:
            return None
        actor = self.scene.actors[det.truth_id]
        if actor.number is None:
            return None
        key = (self.scene.seed, frame.t_ms // SAMPLE_MS, det.truth_id)
        if unit(*key, 1) >= READ_PROBABILITY:
            return None
        if unit(*key, 2) < MISREAD:
            return 1 + int(unit(*key, 3) * 29), 0.3 + 0.3 * unit(*key, 4)
        return actor.number, 0.6 + 0.35 * unit(*key, 5)
