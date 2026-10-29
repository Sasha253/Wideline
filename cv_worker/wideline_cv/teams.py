"""Team assignment by kit colour (C09; CV04).

Each person detection gives a torso colour: the box from 12% to 45% of its
height (below the head, above the shorts), pitch-green pixels masked out,
median CIE Lab. A track's colour is the median over its samples. A seeded
two-centre k-means over all tracks, then again without the outliers, finds
the two outfield kits. An outlier (far from both centres) that spends most of
its time within 20 m of a goal line is a goalkeeper, on the side of the team
whose mean x lies in that half; any other outlier is a referee or official,
side `unknown`, never linked to a player.

Cluster 0 is reported as home; ingest may swap the sides from lineup shirt
numbers (Q-041). When the two kits are close, a warning says so.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from .calibration import green_mask
from .pipeline.types import PITCH_LENGTH, RGB, Detection, TeamSide

Lab = npt.NDArray[np.float64]

OUTLIER_FACTOR = 2.5
OUTLIER_MIN = 18.0
GOAL_ZONE_M = 20.0
GOAL_ZONE_SHARE = 0.6
CLOSE_KITS = 25.0
VERSION = "kit-kmeans-1"


def rgb_to_lab(rgb: npt.NDArray[np.float64]) -> Lab:
    """sRGB (0 to 255, N x 3) to CIE Lab (D65)."""
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    lab: Lab = np.stack(
        [116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], axis=1
    )
    return lab


def torso_colour(frame: RGB, det: Detection) -> Lab | None:
    """Median Lab colour of the torso, pitch green masked out, or None."""
    x0, y0, x1, y1 = det.xyxy
    h = y1 - y0
    fh, fw = frame.shape[:2]
    a, b = max(0, round(x0 + 0.15 * (x1 - x0))), min(fw, round(x1 - 0.15 * (x1 - x0)))
    c, d = max(0, round(y0 + 0.12 * h)), min(fh, round(y0 + 0.45 * h))
    if a >= b or c >= d:
        return None
    crop = frame[c:d, a:b]
    keep = ~green_mask(crop)
    if keep.sum() < 3:
        return None
    lab = rgb_to_lab(crop[keep].astype(np.float64))
    out: Lab = np.median(lab, axis=0)
    return out


def kmeans2(points: Lab, seed: int = 0, iterations: int = 30) -> tuple[Lab, npt.NDArray[np.int_]]:
    """Two-centre k-means. Init: the point farthest from the mean, then the
    point farthest from it, so the result does not depend on the seed for
    well-separated kits; `seed` only breaks exact ties."""
    rng = np.random.default_rng(seed)
    if len(points) < 2:
        return np.array([points[0], points[0]]), np.zeros(len(points), dtype=int)
    mean = points.mean(axis=0)
    first = int(np.argmax(((points - mean) ** 2).sum(axis=1) + rng.uniform(0, 1e-9, len(points))))
    second = int(np.argmax(((points - points[first]) ** 2).sum(axis=1)))
    centres = np.array([points[first], points[second]], dtype=np.float64)
    labels = np.zeros(len(points), dtype=int)
    for _ in range(iterations):
        d = ((points[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
        new = np.argmin(d, axis=1)
        for k in (0, 1):
            if np.any(new == k):
                centres[k] = points[new == k].mean(axis=0)
        if np.array_equal(new, labels):
            break
        labels = new
    # Stable order: the centre with the higher red-green (a*) value is cluster 0.
    if centres[1][1] > centres[0][1]:
        centres = centres[::-1].copy()
        labels = 1 - labels
    return centres, labels


@dataclass(frozen=True)
class TeamResult:
    sides: list[TeamSide]
    roles: list[str]  # outfield | goalkeeper | official | unknown
    warnings: list[str]


def assign_teams(
    colours: Sequence[Lab | None],
    mean_x: Sequence[float | None],
    goal_zone_share: Sequence[tuple[float, float]],
) -> TeamResult:
    """`colours`: each track's median Lab or None; `mean_x`: each track's mean
    pitch x; `goal_zone_share`: the share of samples within 20 m of the left
    and right goal lines."""
    n = len(colours)
    sides: list[TeamSide] = ["unknown"] * n
    roles = ["unknown"] * n
    warnings: list[str] = []
    known = [i for i, c in enumerate(colours) if c is not None]
    if len(known) < 2:
        if n:
            warnings.append("teams not assigned: too few tracks with a kit colour")
        return TeamResult(sides, roles, warnings)
    pts = np.array([colours[i] for i in known], dtype=np.float64)
    centres, labels = kmeans2(pts)
    dist = np.sqrt(((pts - centres[labels]) ** 2).sum(axis=1))
    limit = max(OUTLIER_MIN, OUTLIER_FACTOR * float(np.median(dist)))
    inlier = dist <= limit
    if inlier.sum() >= 2:
        centres, _ = kmeans2(pts[inlier])
        d = np.sqrt(((pts[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2))
        labels = np.argmin(d, axis=1)
        dist = d[np.arange(len(pts)), labels]
        limit = max(OUTLIER_MIN, OUTLIER_FACTOR * float(np.median(dist[inlier])))
        inlier = dist <= limit
    team_x: dict[int, list[float]] = {0: [], 1: []}
    for j, i in enumerate(known):
        if inlier[j]:
            sides[i] = "home" if labels[j] == 0 else "away"
            roles[i] = "outfield"
            mx = mean_x[i]
            if mx is not None:
                team_x[int(labels[j])].append(mx)
    means = {k: (float(np.mean(v)) if v else None) for k, v in team_x.items()}
    for j, i in enumerate(known):
        if inlier[j]:
            continue
        left, right = goal_zone_share[i]
        half: str | None = None
        if left >= GOAL_ZONE_SHARE:
            half = "left"
        elif right >= GOAL_ZONE_SHARE:
            half = "right"
        if half is None:
            roles[i] = "official"
            continue
        roles[i] = "goalkeeper"
        candidates = [
            k
            for k, m in means.items()
            if m is not None and ((m < PITCH_LENGTH / 2) == (half == "left"))
        ]
        if len(candidates) == 1:
            sides[i] = "home" if candidates[0] == 0 else "away"
        elif means[0] is not None and means[1] is not None:
            # Both teams' means in one half: the one nearer that goal.
            nearer = 0 if (means[0] < means[1]) == (half == "left") else 1
            sides[i] = "home" if nearer == 0 else "away"
    gap = float(np.sqrt(((centres[0] - centres[1]) ** 2).sum()))
    if gap < CLOSE_KITS:
        warnings.append(f"team kits look alike (colour distance {gap:.0f}): sides may be mixed")
    return TeamResult(sides, roles, warnings)


def goal_zone_shares(xs: Sequence[float]) -> tuple[float, float]:
    if not xs:
        return (0.0, 0.0)
    a = np.asarray(xs)
    return (float(np.mean(a <= GOAL_ZONE_M)), float(np.mean(a >= PITCH_LENGTH - GOAL_ZONE_M)))
