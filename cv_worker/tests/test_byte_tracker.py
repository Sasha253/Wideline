"""C09: the vendored ByteTrack keeps identities through a crossing and a short occlusion."""

from __future__ import annotations

import numpy as np

from wideline_cv.pipeline.types import Detection, Frame
from wideline_cv.track.people import PeopleTracker

BLANK = np.zeros((540, 960, 3), dtype=np.uint8)


def box(cx: float, foot: float) -> tuple[float, float, float, float]:
    return (cx - 9, foot - 34, cx + 9, foot)


def ids_by_side(tracker: PeopleTracker) -> dict[int, list[float]]:
    return {t.track_id: [px for _, px, _ in t.samples] for t in tracker.finished()}


def test_two_crossing_players_keep_their_ids() -> None:
    tracker = PeopleTracker()
    for k in range(40):
        a = 200 + 8 * k  # left to right
        b = 520 - 8 * k  # right to left, slightly nearer the camera
        dets = [
            Detection(box(a, 300), 0.9, "person"),
            Detection(box(b, 312), 0.9, "person"),
        ]
        tracker.update(Frame(k * 200, BLANK), dets)
    tracks = ids_by_side(tracker)
    assert len(tracks) == 2
    for xs in tracks.values():
        steps = np.diff(xs)
        assert np.all(steps > 0) or np.all(steps < 0)  # never swapped direction


def test_a_one_second_occlusion_re_associates() -> None:
    tracker = PeopleTracker()
    for k in range(30):
        dets = [] if 10 <= k < 15 else [Detection(box(300 + 3 * k, 300), 0.9, "person")]
        tracker.update(Frame(k * 200, BLANK), dets)
    finished = tracker.finished()
    assert len(finished) == 1
    assert len(finished[0].samples) == 25


def test_short_tracks_are_dropped() -> None:
    tracker = PeopleTracker()
    for k in range(3):
        tracker.update(Frame(k * 200, BLANK), [Detection(box(300, 300), 0.9, "person")])
    assert tracker.finished() == []
