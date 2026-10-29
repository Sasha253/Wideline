"""The C08 stand-in for the pipeline: a valid contract result with no detections.

C09 replaces it with the real pipeline (RF-DETR, ByteTrack, team assignment,
calibration, shirt numbers, events) and its synthetic mode for CI.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .contract import SCHEMA_VERSION

STUB_VERSION = "stub-0"


def run(spec: dict[str, Any], should_stop: Callable[[], bool]) -> dict[str, Any]:
    del should_stop  # the stub finishes at once
    duration = spec.get("durationSec") or 1.0
    fps = spec.get("fps") or 25.0
    return {
        "schemaVersion": SCHEMA_VERSION,
        "jobId": spec["jobId"],
        "matchId": spec["matchId"],
        "modelVersions": {
            "detector": STUB_VERSION,
            "tracker": STUB_VERSION,
            "events": STUB_VERSION,
        },
        "video": {
            "durationSec": float(duration),
            "fps": float(fps),
            "sampledFps": float(spec.get("sampledFps") or 5),
        },
        "calibration": {
            "confidence": 0.0,
            "homography": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        },
        "tracks": [],
        "events": [],
        "warnings": ["pipeline stub: no detections"],
    }
