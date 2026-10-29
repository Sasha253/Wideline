"""Draws the synthetic scene (C09): a green pitch with its lines on grey
stands, each person as a kit-coloured torso with a number patch, and the ball,
at 960 x 540, with numpy only."""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from functools import cached_property

import numpy as np
import numpy.typing as npt

from ..pipeline.types import PITCH_LENGTH, PITCH_WIDTH, RGB, Frame
from .scene import FRAME_H, FRAME_W, Scene

STANDS = (52, 56, 62)
GRASS = ((58, 140, 62), (52, 128, 56))
LINE = (235, 238, 235)
SKIN = (220, 178, 140)
SHORTS = (240, 240, 240)
PATCH = (245, 245, 245)
BALL = (250, 250, 250)
PLAYER_HEIGHT_M = 4.0  # stylised: about twice life size, so boxes are easy to follow
BALL_RADIUS_M = 0.45


def _lines() -> list[npt.NDArray[np.float64]]:
    """Polylines of the pitch markings in metres."""
    L, W, c = PITCH_LENGTH, PITCH_WIDTH, PITCH_WIDTH / 2
    lines = [
        np.array([[0, 0], [L, 0], [L, W], [0, W], [0, 0]], dtype=np.float64),
        np.array([[L / 2, 0], [L / 2, W]], dtype=np.float64),
    ]
    t = np.linspace(0, 2 * np.pi, 48)
    lines.append(np.c_[L / 2 + 9.15 * np.cos(t), c + 9.15 * np.sin(t)])
    for x0, d in ((0.0, 1.0), (L, -1.0)):
        for depth, half in ((16.5, 20.16), (5.5, 9.16)):
            lines.append(
                np.array(
                    [
                        [x0, c - half],
                        [x0 + d * depth, c - half],
                        [x0 + d * depth, c + half],
                        [x0, c + half],
                    ],
                    dtype=np.float64,
                )
            )
    return lines


class SyntheticFrames:
    """A FrameSource over the scene's samples."""

    def __init__(self, scene: Scene) -> None:
        self.scene = scene

    @cached_property
    def background(self) -> RGB:
        img = np.empty((FRAME_H, FRAME_W, 3), dtype=np.uint8)
        img[:] = STANDS
        inv = np.linalg.inv(self.scene.camera)
        ys, xs = np.mgrid[0:FRAME_H, 0:FRAME_W]
        pix = np.c_[xs.ravel() + 0.5, ys.ravel() + 0.5, np.ones(xs.size)]
        hom = pix @ inv.T
        px = hom[:, 0] / hom[:, 2]
        py = hom[:, 1] / hom[:, 2]
        inside = (px >= 0) & (px <= PITCH_LENGTH) & (py >= 0) & (py <= PITCH_WIDTH)
        stripe = (np.floor(px / 7.5).astype(int) % 2).reshape(FRAME_H, FRAME_W)
        inside = inside.reshape(FRAME_H, FRAME_W)
        img[inside & (stripe == 0)] = GRASS[0]
        img[inside & (stripe == 1)] = GRASS[1]
        for line in _lines():
            pts = self.scene.to_frame(line)
            for a, b in itertools.pairwise(pts):
                n = int(max(abs(b - a)) * 2) + 2
                seg = a + (b - a) * np.linspace(0, 1, n)[:, None]
                xi = np.clip(seg[:, 0].astype(int), 0, FRAME_W - 1)
                yi = np.clip(seg[:, 1].astype(int), 0, FRAME_H - 1)
                img[yi, xi] = LINE
        return img

    def person_box(self, k: int, actor: int) -> tuple[float, float, float, float]:
        px, sc = self.scene.actor_frame
        fx, fy = px[k, actor]
        return person_box_at(float(fx), float(fy), float(sc[k, actor]))

    def ball_box(self, k: int) -> tuple[float, float, float, float] | None:
        px, sc = self.scene.ball_frame
        bx, by = px[k]
        if np.isnan(bx):
            return None
        r = max(2.0, BALL_RADIUS_M * float(sc[k]))
        return (float(bx) - r, float(by) - r, float(bx) + r, float(by) + r)

    def render(self, k: int) -> RGB:
        img = self.background.copy()
        order = np.argsort(self.scene.positions[k][:, 1])[::-1]  # far first
        for i in order:
            actor = self.scene.actors[int(i)]
            x0, y0, x1, y1 = self.person_box(k, int(i))
            h = y1 - y0
            _rect(img, x0 + 0.25 * (x1 - x0), y0, x1 - 0.25 * (x1 - x0), y0 + 0.12 * h, SKIN)
            _rect(img, x0, y0 + 0.12 * h, x1, y0 + 0.55 * h, actor.kit)
            if actor.number is not None:
                cx, cy = (x0 + x1) / 2, y0 + 0.33 * h
                _rect(
                    img,
                    cx - 0.12 * (x1 - x0),
                    cy - 0.05 * h,
                    cx + 0.12 * (x1 - x0),
                    cy + 0.05 * h,
                    PATCH,
                )
            _rect(
                img,
                x0 + 0.1 * (x1 - x0),
                y0 + 0.55 * h,
                x1 - 0.1 * (x1 - x0),
                y0 + 0.72 * h,
                SHORTS,
            )
            _rect(img, x0 + 0.2 * (x1 - x0), y0 + 0.72 * h, x1 - 0.2 * (x1 - x0), y1, SKIN)
        ball = self.ball_box(k)
        if ball is not None:
            _rect(img, *ball, BALL)
        return img

    def frames(self) -> Iterator[Frame]:
        for k in range(self.scene.n):
            yield Frame(self.scene.t_ms(k), self.render(k))


def person_box_at(fx: float, fy: float, scale: float) -> tuple[float, float, float, float]:
    h = PLAYER_HEIGHT_M * scale
    w = 0.55 * h
    return (fx - w / 2, fy - h, fx + w / 2, fy)


def _rect(
    img: RGB, x0: float, y0: float, x1: float, y1: float, colour: tuple[int, int, int]
) -> None:
    h, w = img.shape[:2]
    a, b = max(0, round(x0)), min(w, round(x1))
    c, d = max(0, round(y0)), min(h, round(y1))
    if a < b and c < d:
        img[c:d, a:b] = colour
