"""C09: the ball tracker interpolates short gaps and warns about long ones."""

from __future__ import annotations

from wideline_cv.track.ball import BallTracker, invisible_warning


def test_gaps_of_a_second_or_less_are_interpolated() -> None:
    t = BallTracker()
    for k in range(20):
        seen = not (5 <= k < 9)  # 0.8 s missing
        t.update(k * 200, [(10.0 + k, 30.0, 0.9)] if seen else [])
    track = t.finish()
    assert track.interpolated[5:9] == [True] * 4
    assert track.xy[6] is not None and abs(track.xy[6][0] - 16.0) < 1e-9
    assert track.invisible_ms == 0
    assert invisible_warning(track) is None


def test_long_gaps_count_as_invisible() -> None:
    t = BallTracker()
    for k in range(40):
        seen = k < 5 or k >= 35  # 6 s missing
        t.update(k * 200, [(40.0, 30.0, 0.9)] if seen else [])
    track = t.finish()
    assert track.xy[20] is None
    assert track.invisible_ms == 6000
    assert invisible_warning(track) == "ball not visible for 6s total"


def test_a_far_false_sighting_is_gated_out() -> None:
    t = BallTracker()
    for k in range(10):
        cands = [(20.0 + k, 30.0, 0.9)]
        if k == 5:
            cands.append((90.0, 10.0, 0.95))
        t.update(k * 200, cands)
    track = t.finish()
    assert track.xy[5] is not None and abs(track.xy[5][0] - 25.0) < 1e-9
