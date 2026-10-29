"""Shared fixtures for the worker tests (C09)."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
import structlog


@pytest.fixture(autouse=True)
def _synthetic_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Tests run in synthetic mode with the default seed and cap, whatever the shell says."""
    for key in list(os.environ):
        if key.startswith("WIDELINE_CV_"):
            monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("WIDELINE_CV_MODE", "synthetic")
    yield
    # The CLI tests configure logging onto pytest's captured stderr, which
    # closes after the test.
    structlog.reset_defaults()
