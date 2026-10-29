"""The ball tracker (C09; CV03): one object, constant velocity, in pitch metres.

Each sample it takes the ball candidate nearest the predicted position, within
a gate that widens with the time since the last sighting; after 1 s without
one it takes the highest-scoring candidate instead. A candidate outside the
gate on two samples in a row (within the gate of each other) wins too, so a
false sighting cannot hold the track away from the real ball. Gaps of 1 s or less are
filled by straight-line interpolation; longer gaps stay empty and add to the
"ball not visible" warning.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from ..pipeline.types import BallTrack

SAMPLE_MS = 200
GATE_M = 7.0
GATE_GROWTH_M = 3.0  # per missed sample
MAX_INTERPOLATE_MS = 1000
REACQUIRE_AFTER_MS = 1000


class BallTracker:
    def __init__(self) -> None:
        self.t_ms: list[int] = []
        self.raw: list[tuple[float, float] | None] = []
        self._last: tuple[int, float, float] | None = None
        self._vel = (0.0, 0.0)
        self._pending: tuple[int, float, float] | None = None

    def update(self, t_ms: int, candidates: Sequence[tuple[float, float, float]]) -> None:
        """`candidates`: (x, y, score) in pitch metres."""
        chosen: tuple[float, float] | None = None
        live = [c for c in candidates if math.isfinite(c[0]) and math.isfinite(c[1])]
        if live:
            if self._last is None or t_ms - self._last[0] > REACQUIRE_AFTER_MS:
                best = max(live, key=lambda c: c[2])
                chosen = (best[0], best[1])
            else:
                lt, lx, ly = self._last
                dt = (t_ms - lt) / 1000
                px, py = lx + self._vel[0] * dt, ly + self._vel[1] * dt
                gate = GATE_M + GATE_GROWTH_M * max(0, (t_ms - lt) // SAMPLE_MS - 1)
                near = min(live, key=lambda c: math.hypot(c[0] - px, c[1] - py))
                if math.hypot(near[0] - px, near[1] - py) <= gate:
                    chosen = (near[0], near[1])
                else:
                    pend = self._pending
                    if pend is not None and t_ms - pend[0] <= 2 * SAMPLE_MS:
                        again = min(live, key=lambda c: math.hypot(c[0] - pend[1], c[1] - pend[2]))
                        if math.hypot(again[0] - pend[1], again[1] - pend[2]) <= GATE_M:
                            chosen = (again[0], again[1])
                            self._last = None  # a fresh start: no velocity across the jump
                    if chosen is None:
                        best = max(live, key=lambda c: c[2])
                        self._pending = (t_ms, best[0], best[1])
        if chosen is not None:
            self._pending = None
            if self._last is not None and t_ms - self._last[0] <= REACQUIRE_AFTER_MS:
                dt = (t_ms - self._last[0]) / 1000
                self._vel = ((chosen[0] - self._last[1]) / dt, (chosen[1] - self._last[2]) / dt)
            else:
                self._vel = (0.0, 0.0)
            self._last = (t_ms, chosen[0], chosen[1])
        self.t_ms.append(t_ms)
        self.raw.append(chosen)

    def finish(self) -> BallTrack:
        xy = list(self.raw)
        interp = [False] * len(xy)
        invisible = 0
        i = 0
        while i < len(xy):
            if xy[i] is not None:
                i += 1
                continue
            j = i
            while j < len(xy) and xy[j] is None:
                j += 1
            before = xy[i - 1] if i > 0 else None
            after = xy[j] if j < len(xy) else None
            t0 = self.t_ms[i - 1] if i > 0 else self.t_ms[i]
            t1 = self.t_ms[j] if j < len(xy) else self.t_ms[-1]
            if before is not None and after is not None and t1 - t0 <= MAX_INTERPOLATE_MS:
                for k in range(i, j):
                    f = (self.t_ms[k] - t0) / (t1 - t0)
                    xy[k] = (
                        before[0] + (after[0] - before[0]) * f,
                        before[1] + (after[1] - before[1]) * f,
                    )
                    interp[k] = True
            else:
                invisible += (j - i) * SAMPLE_MS
            i = j
        return BallTrack(t_ms=list(self.t_ms), xy=xy, interpolated=interp, invisible_ms=invisible)


def invisible_warning(track: BallTrack) -> str | None:
    seconds = round(track.invisible_ms / 1000)
    return f"ball not visible for {seconds}s total" if seconds >= 1 else None
