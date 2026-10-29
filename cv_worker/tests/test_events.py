"""C09: the event heuristics on scripted ball paths."""

from __future__ import annotations

from collections.abc import Sequence

from wideline_cv.events import EVENT_PARAMS, PipelineEvent, dedup, detect_events
from wideline_cv.pipeline.types import BallTrack

DT = 200
Path = list[tuple[float, float] | None]
People = list[tuple[int, Sequence[tuple[int, float, float]]]]


def ball(points: Path) -> BallTrack:
    return BallTrack(
        t_ms=[k * DT for k in range(len(points))],
        xy=list(points),
        interpolated=[False] * len(points),
        invisible_ms=0,
    )


def hold_then_kick(
    at: tuple[float, float], vel: tuple[float, float], hold: int = 8, fly: int = 8
) -> Path:
    pts: Path = [at] * hold
    x, y = at
    for _ in range(fly):
        x, y = x + vel[0] * DT / 1000, y + vel[1] * DT / 1000
        pts.append((x, y))
    return pts


def player_at(points: Path, index: int = 0) -> People:
    """A player standing on the ball's first position the whole time."""
    first = points[0]
    assert first is not None
    return [(index, [(k * DT, first[0] - 0.3, first[1]) for k in range(len(points))])]


def kinds(events: list[PipelineEvent]) -> list[str]:
    return [e.type for e in events]


def test_a_touch_is_a_kick_next_to_a_player() -> None:
    pts = hold_then_kick((50.0, 30.0), (9.0, 0.0))
    events = detect_events(ball(pts), player_at(pts), 60_000)
    assert kinds(events) == ["touch"]
    assert events[0].track_index == 0
    assert events[0].clip_start_ms == max(0, events[0].t_ms - 3000)


def test_no_touch_without_a_player_near() -> None:
    pts = hold_then_kick((50.0, 30.0), (9.0, 0.0))
    far: People = [(0, [(k * DT, 40.0, 10.0) for k in range(len(pts))])]
    assert detect_events(ball(pts), far, 60_000) == []


def test_a_shot_on_target() -> None:
    pts = hold_then_kick((85.0, 33.0), (22.0, 0.5))
    events = detect_events(ball(pts), player_at(pts), 60_000)
    shot = next(e for e in events if e.type == "shot")
    assert shot.on_target is True
    assert shot.clip_start_ms == max(0, shot.t_ms - 5000)
    assert shot.clip_end_ms == shot.t_ms + 3000


def test_a_shot_off_target() -> None:
    pts = hold_then_kick((85.0, 34.0), (21.0, 6.0), fly=4)
    events = detect_events(ball(pts), player_at(pts), 60_000)
    shot = next(e for e in events if e.type == "shot")
    assert shot.on_target is False


def test_a_slow_pass_towards_goal_is_not_a_shot() -> None:
    pts = hold_then_kick((85.0, 34.0), (9.0, 0.0))
    assert "shot" not in kinds(detect_events(ball(pts), player_at(pts), 60_000))


def goal_path(restart: bool) -> Path:
    pts = hold_then_kick((88.0, 34.0), (22.0, 0.0), fly=5)  # into the net
    pts += [(106.0, 34.0)] * 5 + [None] * (40 * 5)  # celebration, ball out of view
    centre = (52.5, 34.0) if restart else (30.0, 10.0)
    pts += [centre] * 15
    pts += hold_then_kick(centre, (8.0, 3.0), hold=1, fly=5)
    return pts


def test_a_goal_with_a_restart_is_confident() -> None:
    pts = goal_path(restart=True)
    events = detect_events(ball(pts), player_at(pts), 600_000)
    goal = next(e for e in events if e.type == "goal")
    assert goal.confidence >= 0.9
    assert goal.track_index == 0
    assert goal.x == 105.0
    assert any(e.type == "shot" and e.on_target for e in events)
    assert goal.clip_start_ms == max(0, goal.t_ms - 8000)
    assert goal.clip_end_ms == goal.t_ms + 5000


def test_a_goal_without_a_restart_is_doubtful() -> None:
    pts = goal_path(restart=False)
    goal = next(e for e in detect_events(ball(pts), player_at(pts), 600_000) if e.type == "goal")
    assert goal.confidence < 0.9


def test_duplicates_within_a_second_are_one_event() -> None:
    def e(t: int, conf: float) -> PipelineEvent:
        return PipelineEvent("touch", t, 0, 1.0, 1.0, conf, 0, t + 1, None)

    kept = dedup([e(1000, 0.7), e(1600, 0.9), e(2700, 0.8)], EVENT_PARAMS)
    assert [(k.t_ms, k.confidence) for k in kept] == [(1600, 0.9), (2700, 0.8)]


def test_clip_windows_are_clamped_to_the_video() -> None:
    pts = hold_then_kick((50.0, 30.0), (9.0, 0.0), hold=3)
    events = detect_events(ball(pts), player_at(pts), 1500)
    assert all(0 <= e.clip_start_ms <= e.t_ms <= e.clip_end_ms <= 1500 for e in events)
