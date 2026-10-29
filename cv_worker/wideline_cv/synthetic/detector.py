"""The synthetic detector (C09): the scene's own boxes with seeded jitter,
about 5% of people and 6% of balls missed, and the odd false positive.
Deterministic for the scene's seed and the sample."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from ..pipeline.types import Detection, Frame
from .render import SyntheticFrames, person_box_at
from .scene import FRAME_H, FRAME_W, SAMPLE_MS, Scene

VERSION = "synthetic-1"
JITTER_PX = 0.8
PERSON_MISS = 0.05
BALL_MISS = 0.06
FALSE_PERSON = 0.02
FALSE_BALL = 0.02


class SyntheticDetector:
    version = VERSION

    def __init__(self, scene: Scene) -> None:
        self.scene = scene
        self.draw = SyntheticFrames(scene)

    def _rng(self, k: int, salt: int) -> np.random.Generator:
        return np.random.default_rng([self.scene.seed, k, salt])

    def detect_one(self, k: int) -> list[Detection]:
        rng = self._rng(k, 1)
        out: list[Detection] = []
        for actor in self.scene.actors:
            if rng.random() < PERSON_MISS:
                continue
            box = np.array(self.draw.person_box(k, actor.id))
            box += rng.normal(0, JITTER_PX, size=4)
            out.append(
                Detection(_box(box), float(rng.uniform(0.7, 0.97)), "person", truth_id=actor.id)
            )
        if rng.random() < FALSE_PERSON:
            x, y = rng.uniform(5, 100), rng.uniform(5, 63)
            fx, fy = self.scene.to_frame([[x, y]])[0]
            box = np.array(person_box_at(float(fx), float(fy), self.scene.scale_at(x, y)))
            out.append(Detection(_box(box), float(rng.uniform(0.3, 0.55)), "person"))
        ball = self.draw.ball_box(k)
        if ball is not None and rng.random() >= BALL_MISS:
            box = np.array(ball)
            box += rng.normal(0, JITTER_PX * 0.6, size=4)
            out.append(Detection(_box(box), float(rng.uniform(0.6, 0.95)), "ball", truth_id=-1))
        if rng.random() < FALSE_BALL:
            fx, fy = rng.uniform(0, FRAME_W), rng.uniform(FRAME_H * 0.25, FRAME_H)
            out.append(
                Detection((fx - 3, fy - 3, fx + 3, fy + 3), float(rng.uniform(0.3, 0.45)), "ball")
            )
        return out

    def detect(self, frames: Sequence[Frame]) -> list[list[Detection]]:
        return [self.detect_one(f.t_ms // SAMPLE_MS) for f in frames]


def _box(b: np.ndarray) -> tuple[float, float, float, float]:
    return (float(b[0]), float(b[1]), float(b[2]), float(b[3]))
