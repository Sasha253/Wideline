"""Error text fit for a log line or the failed callback (C08, C09)."""

from __future__ import annotations

import re

ERROR_MAX = 500


def clean(text: str) -> str:
    """Error text without URLs' query strings, capped."""
    cleaned = re.sub(r"(https?://[^\s?'\"]*)\?[^\s'\"]*", r"\1?[redacted]", text).strip()
    return cleaned[:ERROR_MAX] or "worker failed"
