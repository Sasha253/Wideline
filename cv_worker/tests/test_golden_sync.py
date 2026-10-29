"""C09: the committed golden run equals fresh synthetic output (as test_contract_sync).

Regenerate with `make cv-golden` after a deliberate pipeline change. Floats
are compared to 0.05, so a last-bit difference between platforms does not fail it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from wideline_cv.contract import validate
from wideline_cv.synthetic import golden

FIXTURES = Path(__file__).resolve().parents[2] / "web/tests/fixtures/cv"
pytestmark = pytest.mark.skipif(
    not (FIXTURES / golden.RESULT_FILE).exists(), reason="web fixtures not checked out"
)


def _close(a: Any, b: Any, path: str = "") -> None:
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), path
        for k in a:
            _close(a[k], b[k], f"{path}/{k}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            _close(x, y, f"{path}/{i}")
    elif isinstance(a, float) or isinstance(b, float):
        assert abs(float(a) - float(b)) <= 0.05, path
    else:
        assert a == b, path


def test_result_matches_fresh_output() -> None:
    committed = json.loads((FIXTURES / golden.RESULT_FILE).read_text(encoding="utf-8"))
    validate(committed)
    _close(committed, golden.golden_result())


def test_truth_matches_fresh_output() -> None:
    committed = (FIXTURES / golden.TRUTH_FILE).read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == golden.golden_truth()


def test_golden_has_the_numbers_the_web_tests_use() -> None:
    result = json.loads((FIXTURES / golden.RESULT_FILE).read_text(encoding="utf-8"))
    numbered = {(t["teamSide"], t["shirtNumber"]) for t in result["tracks"] if t["shirtNumber"]}
    assert {("home", 7), ("home", 9)} <= numbered
    types = {e["type"] for e in result["events"]}
    assert types == {"goal", "shot", "touch"}
