"""C09: the DLT both ways on the cases shared with web/src/lib/homography.ts,
the frame-fit fallback, and the off-pitch rule."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from wideline_cv.calibration import (
    FALLBACK_CONFIDENCE,
    CalibrationError,
    fallback,
    fit_homography,
    from_spec,
    on_pitch,
    project,
)
from wideline_cv.synthetic.render import SyntheticFrames
from wideline_cv.synthetic.scene import Scene

CASES = Path(__file__).resolve().parents[2] / "web/tests/fixtures/cv/homography-cases.json"
shared = pytest.mark.skipif(not CASES.exists(), reason="web fixtures not checked out")


def _cases() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(CASES.read_text(encoding="utf-8"))
    return data


@shared
def test_shared_cases_fit_the_same_homography() -> None:
    for case in _cases()["cases"]:
        pairs = [(tuple(p["image"]), tuple(p["pitch"])) for p in case["points"]]
        h, err = fit_homography(pairs)
        assert err == pytest.approx(case["errorM"], abs=1e-4), case["name"]
        for probe in case["probes"]:
            got = project(h, [probe["image"]])[0]
            assert got == pytest.approx(probe["pitch"], abs=1e-4), case["name"]
        # Both ways: the inverse maps the pitch back onto the image.
        back = project(np.linalg.inv(h), [p["pitch"] for p in case["points"]])
        assert back == pytest.approx(np.array([p["image"] for p in case["points"]]), abs=5.0)


@shared
def test_shared_failures_are_refused() -> None:
    for case in _cases()["failures"]:
        pairs = [(tuple(p["image"]), tuple(p["pitch"])) for p in case["points"]]
        with pytest.raises(CalibrationError):
            fit_homography(pairs)


def test_fallback_is_low_confidence_and_close_on_the_synthetic_pitch() -> None:
    scene = Scene(7, 2)
    frame = SyntheticFrames(scene).render(0)
    cal = fallback(frame, (1920, 1080))
    assert cal.confidence <= 0.2 and cal.confidence == FALLBACK_CONFIDENCE
    assert cal.source == "fallback"
    centre_px = scene.to_frame([[52.5, 34.0]])[0] * 2
    assert project(cal.H, [centre_px])[0] == pytest.approx([52.5, 34.0], abs=1.5)


def test_fallback_without_a_pitch_maps_the_frame() -> None:
    cal = fallback(np.zeros((540, 960, 3), dtype=np.uint8), (1920, 1080))
    assert project(cal.H, [[0.0, 1080.0]])[0] == pytest.approx([0.0, 0.0], abs=1e-6)


def test_off_pitch_points_are_dropped_and_near_ones_clamped() -> None:
    assert on_pitch(50.0, 30.0) == (50.0, 30.0)
    assert on_pitch(-1.5, 30.0) == (0.0, 30.0)
    assert on_pitch(106.9, 69.0) == (105.0, 68.0)
    assert on_pitch(-2.5, 30.0) is None
    assert on_pitch(50.0, 70.5) is None
    assert on_pitch(float("nan"), 1.0) is None


def test_from_spec_uses_the_stored_calibration() -> None:
    h = [[0.05, 0.0, 0.0], [0.0, -0.06, 64.0], [0.0, 0.0, 1.0]]
    cal = from_spec({"calibration": {"id": "cal_1", "homography": h, "confidence": 0.9}})
    assert cal is not None and cal.source == "stored" and cal.calibration_id == "cal_1"
    assert from_spec({"calibration": None}) is None
