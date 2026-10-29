"""C09: the synthetic pipeline end to end, as CI runs it (no GPU, weights or network)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from recall import recall

from wideline_cv.contract import validate
from wideline_cv.pipeline import run
from wideline_cv.synthetic.scene import Scene

DURATION = 360.0
SEED = 7


def _spec(duration: float) -> dict[str, Any]:
    return {
        "jobId": "job_s",
        "matchId": "match_s",
        "durationSec": duration,
        "fps": 25.0,
        "sampledFps": 5,
        "width": 1920,
        "height": 1080,
        "syntheticSeed": SEED,
    }


@pytest.fixture(scope="module")
def six_minutes() -> dict[str, Any]:
    return run(_spec(DURATION), lambda: False, lambda _rgb: None)


def test_result_passes_the_contract(six_minutes: dict[str, Any]) -> None:
    validate(six_minutes)
    assert six_minutes["modelVersions"]["detector"] == "synthetic-1"
    assert six_minutes["video"]["durationSec"] == DURATION
    assert "pitch not calibrated: positions are approximate" in six_minutes["warnings"]


def test_goal_and_shot_recall_meet_the_target(six_minutes: dict[str, Any]) -> None:
    truth = Scene(SEED, DURATION).truth
    assert any(e.type == "goal" for e in truth)
    assert recall("goal", truth, six_minutes["events"]) >= 0.9
    assert recall("shot", truth, six_minutes["events"]) >= 0.9
    assert recall("touch", truth, six_minutes["events"]) >= 0.8


def test_clip_windows_hold_their_event(six_minutes: dict[str, Any]) -> None:
    for e in six_minutes["events"]:
        assert 0 <= e["clipStartMs"] <= e["tMs"] <= e["clipEndMs"] <= DURATION * 1000


def test_no_point_lies_off_the_pitch(six_minutes: dict[str, Any]) -> None:
    for track in six_minutes["tracks"]:
        times = [p["tMs"] for p in track["points"]]
        assert times == sorted(set(times))
        for p in track["points"]:
            assert 0 <= p["x"] <= 105 and 0 <= p["y"] <= 68


def test_tracks_carry_sides_and_numbers(six_minutes: dict[str, Any]) -> None:
    sides = {t["teamSide"] for t in six_minutes["tracks"]}
    assert {"home", "away"} <= sides
    numbered = [t for t in six_minutes["tracks"] if t["shirtNumber"] is not None]
    assert numbered and all(0 < t["shirtConfidence"] <= 1 for t in numbered)


def test_runs_are_deterministic() -> None:
    a = run(_spec(40.0), lambda: False, lambda _rgb: None)
    b = run(_spec(40.0), lambda: False, lambda _rgb: None)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_should_stop_ends_the_run() -> None:
    with pytest.raises(RuntimeError, match="stopped"):
        run(_spec(30.0), lambda: True, lambda _rgb: None)
