"""The committed golden synthetic run (C09).

web/tests/fixtures/cv/synthetic-result.json and synthetic-truth.csv are this
scene's pipeline result and ground truth. The web tests feed the result
through ingest and the clips job; tests/test_golden_sync.py checks both files
still equal fresh output. Regenerate with `make cv-golden`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .scene import Scene
from .truth import truth_csv

SEED = 7
DURATION_SEC = 90.0
SPEC: dict[str, Any] = {
    "jobId": "golden-job",
    "matchId": "golden-match",
    "durationSec": DURATION_SEC,
    "fps": 25.0,
    "sampledFps": 5,
    "width": 1920,
    "height": 1080,
    "mode": "synthetic",
    "syntheticSeed": SEED,
}
RESULT_FILE = "synthetic-result.json"
TRUTH_FILE = "synthetic-truth.csv"


def golden_result() -> dict[str, Any]:
    from ..pipeline import run

    return run(dict(SPEC), lambda: False, lambda _rgb: None)


def golden_truth() -> str:
    return truth_csv(Scene(SEED, DURATION_SEC))


def dumps(result: dict[str, Any]) -> str:
    return json.dumps(result, separators=(",", ":"), sort_keys=True) + "\n"


def write(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / RESULT_FILE).write_text(dumps(golden_result()), encoding="utf-8", newline="\n")
    (out_dir / TRUTH_FILE).write_text(golden_truth(), encoding="utf-8", newline="\n")
