"""The worker's bundled contract schema must equal the web app's copy (C08)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wideline_cv.contract import SCHEMA_PATH

WEB_COPY = Path(__file__).resolve().parents[2] / "web/src/server/cv/contract" / SCHEMA_PATH.name


@pytest.mark.skipif(not WEB_COPY.exists(), reason="web app not checked out next to the worker")
def test_schema_matches_the_web_copy() -> None:
    assert json.loads(SCHEMA_PATH.read_text(encoding="utf-8")) == json.loads(
        WEB_COPY.read_text(encoding="utf-8")
    )
