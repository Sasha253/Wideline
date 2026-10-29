"""Pitch calibration (C09; CV05): one homography from video pixels to pitch metres.

- `from_spec(spec)` uses the calibration the app stored for the venue and
  camera (a platform admin placed landmarks in the Lab, Q-042).
- Otherwise `fallback(frame, ...)` fits the green pitch area to the 105 x 68
  rectangle: the top and bottom rows of the pitch mask, and a straight line
  through its left and right edges, give four corners. It is a guess, so its
  confidence is at most 0.2 and the result carries a warning.
- `project()` maps pixels to metres; `on_pitch()` drops points more than 2 m
  outside the pitch and clamps the rest.
- `fit_homography()` is the normalised DLT the Lab uses (a TypeScript port
  lives in web/src/lib/homography.ts; both are tested against
  web/tests/fixtures/cv/homography-cases.json).

Coordinates are camera-fixed: x = 0 at the goal on the camera's left, y = 0 on
the near touchline (Q-043).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
import numpy.typing as npt

from .pipeline.types import PITCH_LENGTH, PITCH_WIDTH, RGB, Calibration, Matrix

FALLBACK_CONFIDENCE = 0.2
FALLBACK_WARNING = "pitch not calibrated: positions are approximate"
OFF_PITCH_MARGIN_M = 2.0


class CalibrationError(ValueError):
    """The points do not determine a homography (fewer than 4, or degenerate)."""


def _normaliser(pts: npt.NDArray[np.float64]) -> Matrix:
    centre = pts.mean(axis=0)
    dist = np.sqrt(((pts - centre) ** 2).sum(axis=1)).mean()
    if dist < 1e-9:
        raise CalibrationError("points coincide")
    s = np.sqrt(2.0) / dist
    return np.array([[s, 0.0, -s * centre[0]], [0.0, s, -s * centre[1]], [0.0, 0.0, 1.0]])


def fit_homography(
    correspondences: Sequence[tuple[tuple[float, float], tuple[float, float]]],
) -> tuple[Matrix, float]:
    """Fits H (source to target) by normalised DLT. Returns (H, RMS reprojection
    error in target units). Each correspondence is ((sx, sy), (tx, ty))."""
    if len(correspondences) < 4:
        raise CalibrationError("at least 4 points are needed")
    src = np.array([c[0] for c in correspondences], dtype=np.float64)
    dst = np.array([c[1] for c in correspondences], dtype=np.float64)
    ts, td = _normaliser(src), _normaliser(dst)
    s = (ts @ np.c_[src, np.ones(len(src))].T).T
    d = (td @ np.c_[dst, np.ones(len(dst))].T).T
    rows: list[list[float]] = []
    for (x, y, _), (u, v, _) in zip(s, d, strict=True):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    a = np.array(rows, dtype=np.float64)
    _, sv, vt = np.linalg.svd(a)
    # A rank below 8 means the points are collinear or repeated.
    if sv[min(7, len(sv) - 1)] < 1e-8 * sv[0]:
        raise CalibrationError("points are degenerate")
    hn = vt[-1].reshape(3, 3)
    h = np.linalg.inv(td) @ hn @ ts
    if abs(h[2, 2]) < 1e-12:
        raise CalibrationError("points are degenerate")
    h = h / h[2, 2]
    proj = project(h, src)
    if not np.all(np.isfinite(proj)):
        raise CalibrationError("points are degenerate")
    err = float(np.sqrt(((proj - dst) ** 2).sum(axis=1).mean()))
    return h, err


def project(h: Matrix, pts: npt.ArrayLike) -> npt.NDArray[np.float64]:
    """Applies H to N x 2 points."""
    p = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
    hom = p @ h[:, :2].T + h[:, 2]
    w = hom[:, 2:3]
    with np.errstate(divide="ignore", invalid="ignore"):
        out: npt.NDArray[np.float64] = hom[:, :2] / w
    return out


def on_pitch(x: float, y: float) -> tuple[float, float] | None:
    """Clamps a point within 2 m of the pitch onto it; None when further out."""
    m = OFF_PITCH_MARGIN_M
    if not (np.isfinite(x) and np.isfinite(y)):
        return None
    if x < -m or x > PITCH_LENGTH + m or y < -m or y > PITCH_WIDTH + m:
        return None
    return (min(max(x, 0.0), PITCH_LENGTH), min(max(y, 0.0), PITCH_WIDTH))


def from_spec(spec: dict[str, Any]) -> Calibration | None:
    """The stored calibration in the job spec, or None."""
    cal = spec.get("calibration")
    if not cal:
        return None
    h = np.array(cal["homography"], dtype=np.float64)
    if h.shape != (3, 3) or not np.all(np.isfinite(h)):
        return None
    return Calibration(
        H=h,
        confidence=float(min(max(cal.get("confidence", 1.0), 0.0), 1.0)),
        source="stored",
        calibration_id=cal.get("id"),
    )


def green_mask(rgb: RGB) -> npt.NDArray[np.bool_]:
    """Pitch-green pixels: hue roughly 70 to 170 degrees, some saturation."""
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    return (g >= r) & (g >= b) & (sat > 0.2) & (mx > 40)


def fallback(rgb: RGB, video_size: tuple[int, int]) -> Calibration:
    """A low-confidence guess from the green pitch area of one frame.

    The rows where the mask starts and ends are the far and near touchlines;
    lines fitted through the leftmost and rightmost green pixel of each row
    are the goal lines. Their four intersections map to the pitch corners.
    With too little green, it maps the whole frame to the pitch."""
    frame_h, frame_w = rgb.shape[:2]
    sx, sy = video_size[0] / frame_w, video_size[1] / frame_h
    mask = green_mask(rgb)
    rows = np.where(mask.mean(axis=1) > 0.05)[0]
    corners: npt.NDArray[np.float64] | None = None
    if len(rows) >= 10:
        top, bottom = int(rows[0]), int(rows[-1])
        ys, lefts, rights = [], [], []
        for y in rows:
            cols = np.where(mask[y])[0]
            ys.append(float(y))
            lefts.append(float(cols[0]))
            rights.append(float(cols[-1]))
        ya = np.array(ys)
        lf = np.polyfit(ya, np.array(lefts), 1)
        rf = np.polyfit(ya, np.array(rights), 1)
        corners = np.array(
            [
                [np.polyval(lf, bottom), bottom + 1.0],  # near left
                [np.polyval(rf, bottom) + 1.0, bottom + 1.0],  # near right
                [np.polyval(rf, top) + 1.0, float(top)],  # far right
                [np.polyval(lf, top), float(top)],  # far left
            ]
        )
    if corners is None:
        corners = np.array(
            [[0.0, frame_h], [frame_w, frame_h], [frame_w, 0.0], [0.0, 0.0]], dtype=np.float64
        )
    corners[:, 0] *= sx
    corners[:, 1] *= sy
    pitch = [(0.0, 0.0), (PITCH_LENGTH, 0.0), (PITCH_LENGTH, PITCH_WIDTH), (0.0, PITCH_WIDTH)]
    try:
        h, _ = fit_homography(
            [((float(c[0]), float(c[1])), p) for c, p in zip(corners, pitch, strict=True)]
        )
    except CalibrationError:
        h = np.diag([PITCH_LENGTH / video_size[0], PITCH_WIDTH / video_size[1], 1.0])
        h[1] = [0.0, -PITCH_WIDTH / video_size[1], PITCH_WIDTH]
    return Calibration(H=h, confidence=FALLBACK_CONFIDENCE, source="fallback")
