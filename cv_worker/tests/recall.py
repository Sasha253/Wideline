"""Recall as the Lab measures it (web/src/server/lab/recall.ts, Q-046), for tests."""

from __future__ import annotations

from typing import Any

TOLERANCE_MS = {"goal": 2000, "shot": 2000, "touch": 1000}


def matched(tags: list[int], found: list[int], tolerance: int) -> int:
    """Greedy one-to-one matching by time: each tag takes the nearest free detection."""
    used: set[int] = set()
    hits = 0
    for tag in sorted(tags):
        best = None
        for i, t in enumerate(found):
            if i in used or abs(t - tag) > tolerance:
                continue
            if best is None or abs(t - tag) < abs(found[best] - tag):
                best = i
        if best is not None:
            used.add(best)
            hits += 1
    return hits


def recall(kind: str, truth: list[Any], events: list[dict[str, Any]]) -> float:
    tags = [e.t_ms for e in truth if e.type == kind]
    found = [e["tMs"] for e in events if e["type"] == kind]
    if not tags:
        return 1.0
    return matched(tags, found, TOLERANCE_MS[kind]) / len(tags)
