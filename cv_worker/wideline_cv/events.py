"""Event detection (C09; CV07): touch, shot (with on target) and goal, from
the ball track and the people tracks in pitch metres. Heuristics, not a
model; every constant is in EVENT_PARAMS (draft, tuned from the Lab's recall
numbers, A-16).

- Touch: the ball's velocity changes (direction by more than 30 degrees or
  speed by more than 40%, at 4 m/s or more on one side) with a player's foot
  point within 1.5 m. That player's track gets the event.
- Shot: within 0.6 s after a touch the ball goes faster than 12 m/s, heading
  for the goal mouth (wide cone), from within 35 m of that goal. On target
  when the projected path crosses the goal line between the posts (34 +/-
  3.66 m, plus 0.3 m).
- Goal: the ball crosses the goal line between the posts, then a restart
  check: within 30 to 150 s the ball is still for 2 s or more within 2 m of
  the centre spot. A goal also emits its shot when none was found.
- Confidence: a logistic combination of each event's cues.
- Clip windows: shot -5/+3 s, goal -8/+5 s, touch -3/+2 s, clamped to the video.
- Events of one type within 1 s of each other are one event.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from .calibration import on_pitch
from .pipeline.types import PITCH_LENGTH, PITCH_WIDTH, BallTrack, EventType, PipelineEvent

VERSION = "wideline-events-0.1"


@dataclass(frozen=True)
class EventParams:
    touch_angle_deg: float = 30.0
    touch_speed_change: float = 0.4
    touch_min_speed: float = 4.0
    touch_player_m: float = 1.5
    shot_window_s: float = 0.6
    shot_min_speed: float = 12.0
    shot_max_distance_m: float = 35.0
    shot_cone_m: float = 6.0  # beyond the posts, for the heading check
    post_half_m: float = 3.66
    on_target_margin_m: float = 0.3
    restart_min_s: float = 30.0
    restart_max_s: float = 150.0
    restart_still_s: float = 2.0
    restart_still_speed: float = 1.5
    restart_radius_m: float = 2.0
    dedup_s: float = 1.0
    clip: tuple[tuple[EventType, int, int], ...] = (
        ("shot", 5000, 3000),
        ("goal", 8000, 5000),
        ("touch", 3000, 2000),
    )


EVENT_PARAMS = EventParams()

Point = tuple[float, float]
# Each track: sorted (tMs, x, y) in pitch metres, and its index in the result.
PeoplePoints = Sequence[tuple[int, Sequence[tuple[int, float, float]]]]


def _logistic(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def clip_window(kind: EventType, t_ms: int, duration_ms: int, p: EventParams) -> tuple[int, int]:
    before, after = next((b, a) for k, b, a in p.clip if k == kind)
    return max(0, t_ms - before), min(duration_ms, t_ms + after)


def _speed(a: Point, b: Point, dt: float) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1]) / dt


def _nearest_player(
    people: PeoplePoints, t_ms: int, at: Point, tolerance_ms: int = 400
) -> tuple[int | None, float]:
    best: tuple[int | None, float] = (None, math.inf)
    for index, points in people:
        lo, hi = 0, len(points)
        while lo < hi:
            mid = (lo + hi) // 2
            if points[mid][0] < t_ms:
                lo = mid + 1
            else:
                hi = mid
        for j in (lo - 1, lo):
            if 0 <= j < len(points) and abs(points[j][0] - t_ms) <= tolerance_ms:
                d = math.hypot(points[j][1] - at[0], points[j][2] - at[1])
                if d < best[1]:
                    best = (index, d)
    return best


def _cross_y(start: Point, vel: Point, goal_x: float) -> float | None:
    if abs(vel[0]) < 1e-6 or (goal_x - start[0]) / vel[0] < 0:
        return None
    return start[1] + vel[1] * (goal_x - start[0]) / vel[0]


def detect_events(
    ball: BallTrack,
    people: PeoplePoints,
    duration_ms: int,
    p: EventParams = EVENT_PARAMS,
) -> list[PipelineEvent]:
    ts, xy = ball.t_ms, ball.xy
    n = len(ts)
    out: list[PipelineEvent] = []

    def ev(
        kind: EventType,
        t: int,
        at: Point | None,
        conf: float,
        track: int | None,
        on_target: bool | None = None,
    ) -> PipelineEvent:
        start, end = clip_window(kind, t, duration_ms, p)
        spot = on_pitch(*at) if at is not None else None
        return PipelineEvent(
            type=kind,
            t_ms=t,
            track_index=track,
            x=round(spot[0], 2) if spot else None,
            y=round(spot[1], 2) if spot else None,
            confidence=round(min(max(conf, 0.0), 1.0), 4),
            clip_start_ms=start,
            clip_end_ms=end,
            on_target=on_target,
        )

    # Touches: change points of the ball's velocity, two samples each side.
    scores: list[float] = [0.0] * n
    for i in range(2, n - 2):
        a, b, c = xy[i - 2], xy[i], xy[i + 2]
        if a is None or b is None or c is None:
            continue
        dt_in, dt_out = (ts[i] - ts[i - 2]) / 1000, (ts[i + 2] - ts[i]) / 1000
        v_in = ((b[0] - a[0]) / dt_in, (b[1] - a[1]) / dt_in)
        v_out = ((c[0] - b[0]) / dt_out, (c[1] - b[1]) / dt_out)
        s_in, s_out = math.hypot(*v_in), math.hypot(*v_out)
        top = max(s_in, s_out)
        if top < p.touch_min_speed:
            continue
        change = abs(s_out - s_in) / top
        angle = 0.0
        if min(s_in, s_out) > 1.0:
            dot = (v_in[0] * v_out[0] + v_in[1] * v_out[1]) / (s_in * s_out)
            angle = math.degrees(math.acos(min(1.0, max(-1.0, dot))))
        if change > p.touch_speed_change or angle > p.touch_angle_deg:
            scores[i] = change + angle / 90.0
    touches: list[tuple[int, int, float]] = []  # (sample, track, confidence)
    for i in range(n):
        if scores[i] <= 0 or any(
            scores[j] > scores[i] for j in range(max(0, i - 2), min(n, i + 3))
        ):
            continue
        b = xy[i]
        assert b is not None
        track, dist = _nearest_player(people, ts[i], b)
        if track is None or dist > p.touch_player_m:
            continue
        conf = _logistic(-1.0 + 2.5 * min(scores[i], 1.5) + 2.0 * (1 - dist / p.touch_player_m))
        touches.append((i, track, conf))
        out.append(ev("touch", ts[i], b, conf, track))

    # Shots: fast, goal-bound ball within 0.6 s after a touch.
    shots: list[tuple[int, int, bool, float]] = []  # (tMs, track, on target, goal_x)
    for i, track, _ in touches:
        b = xy[i]
        assert b is not None
        for j in range(i + 1, n):
            if ts[j] - ts[i] > p.shot_window_s * 1000:
                break
            a2, c2 = xy[j - 1], xy[j]
            if a2 is None or c2 is None:
                continue
            dt = (ts[j] - ts[j - 1]) / 1000
            speed = _speed(a2, c2, dt)
            if speed <= p.shot_min_speed:
                continue
            vel = (
                (c2[0] - b[0]) / ((ts[j] - ts[i]) / 1000),
                (c2[1] - b[1]) / ((ts[j] - ts[i]) / 1000),
            )
            goal_x = PITCH_LENGTH if vel[0] > 0 else 0.0
            dist = math.hypot(goal_x - b[0], PITCH_WIDTH / 2 - b[1])
            cy = _cross_y(b, vel, goal_x)
            if dist > p.shot_max_distance_m or cy is None:
                break
            off = abs(cy - PITCH_WIDTH / 2)
            if off > p.post_half_m + p.shot_cone_m:
                break
            on_target = off <= p.post_half_m + p.on_target_margin_m
            conf = _logistic(
                0.5
                + 0.25 * (speed - p.shot_min_speed)
                + 1.5 * (1 - dist / p.shot_max_distance_m)
                + 1.0 * (1 - off / (p.post_half_m + p.shot_cone_m))
            )
            shots.append((ts[i], track, on_target, goal_x))
            out.append(ev("shot", ts[i], b, conf, track, on_target))
            break

    # Goals: the ball crosses a goal line between the posts; then a restart.
    def restart_after(t_ms: int) -> bool:
        need = int(p.restart_still_s * 1000)
        run_start: int | None = None
        for k in range(n):
            if ts[k] < t_ms + p.restart_min_s * 1000:
                continue
            if ts[k] > t_ms + p.restart_max_s * 1000:
                break
            here = xy[k]
            prev = xy[k - 1] if k > 0 else None
            if here is None or prev is None or ball.interpolated[k]:
                continue  # a missed sighting neither starts nor breaks a run
            still = (
                math.hypot(here[0] - PITCH_LENGTH / 2, here[1] - PITCH_WIDTH / 2)
                <= p.restart_radius_m
                and _speed(prev, here, (ts[k] - ts[k - 1]) / 1000) <= p.restart_still_speed
            )
            if still:
                run_start = ts[k - 1] if run_start is None else run_start
                if ts[k] - run_start >= need:
                    return True
            else:
                run_start = None
        return False

    for i in range(1, n):
        a, b = xy[i - 1], xy[i]
        if a is None or b is None:
            continue
        for goal_x in (0.0, PITCH_LENGTH):
            if not ((a[0] - goal_x) * (b[0] - goal_x) < 0 or (b[0] == goal_x and a[0] != goal_x)):
                continue
            f = (goal_x - a[0]) / (b[0] - a[0])
            y = a[1] + (b[1] - a[1]) * f
            if abs(y - PITCH_WIDTH / 2) > p.post_half_m + p.on_target_margin_m:
                continue
            t_cross = round(ts[i - 1] + (ts[i] - ts[i - 1]) * f)
            speed = _speed(a, b, (ts[i] - ts[i - 1]) / 1000)
            shot = next(
                (s for s in reversed(shots) if s[3] == goal_x and 0 <= t_cross - s[0] <= 4000),
                None,
            )
            restart = restart_after(t_cross)
            conf = _logistic(
                -0.5
                + 2.4 * (1 if restart else 0)
                + 1.0 * (1 if shot else 0)
                + 0.05 * min(speed, 30)
            )
            track = shot[1] if shot else None
            out.append(ev("goal", t_cross, (goal_x, y), conf, track))
            if shot is None:
                # A goal is also a shot: the last touch before it, or the crossing.
                prior = next(
                    (t for t in reversed(touches) if 0 <= t_cross - ts[t[0]] <= 4000), None
                )
                t_shot = ts[prior[0]] if prior else t_cross
                at = xy[prior[0]] if prior else (goal_x, y)
                out.append(ev("shot", t_shot, at, conf * 0.9, prior[1] if prior else None, True))

    return dedup(out, p)


def dedup(events: list[PipelineEvent], p: EventParams = EVENT_PARAMS) -> list[PipelineEvent]:
    """Keeps the most confident event of a type within 1 s; sorted by time."""
    kept: list[PipelineEvent] = []
    for e in sorted(events, key=lambda e: (-e.confidence, e.t_ms, e.type)):
        if any(k.type == e.type and abs(k.t_ms - e.t_ms) < p.dedup_s * 1000 for k in kept):
            continue
        kept.append(e)
    return sorted(
        kept, key=lambda e: (e.t_ms, e.type, e.track_index if e.track_index is not None else -1)
    )
